import { DurableObject } from "cloudflare:workers";
import { Env } from "./index";
import { STRATEGY_CONTEXT, SYSTEM_INSTRUCTIONS } from "./knowledge";
import { MESSAGES_LIMIT } from "./const.js";
import { extractText } from "unpdf";

export class ChatRoom extends DurableObject<Env> {
    constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env);
        // Initialize DB schema
        this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT,
        content TEXT,
        timestamp INTEGER
      );
    `);
    }

    async handleMessage(event: any) {
        const { text, channel, files, user, ts } = event;

        // === FILE HANDLING ===
        if (files && files.length > 0) {
            await this.postToSlack(channel, "📄 I see a file. Processing...");

            for (const file of files) {
                if (file.mimetype === "application/pdf") {
                    try {
                        await this.processSlackFile(file, channel);
                        await this.postToSlack(channel, `✅ Successfully processed: *${file.title}*`);
                    } catch (err: any) {
                        console.error(err);
                        await this.postToSlack(channel, `❌ Error processing ${file.title}: ${err.message}`);
                    }
                } else {
                    await this.postToSlack(channel, `⚠️ I ignored *${file.title}* because it is not a PDF.`);
                }
            }
            return;
        }

        // === 1. Detect Image Request & Clean Text ===
        const wantsImage = text.includes("[IMAGE]");
        const cleanText = text.replace("[IMAGE]", "").replace(/<@[a-zA-Z0-9]+>/g, "").trim();

        // 1. Check Limit
        const countResult = this.ctx.storage.sql.exec(
            `SELECT COUNT(*) as count FROM messages WHERE role = 'model'`
        );
        // @ts-ignore
        const responseCount: number = [...countResult][0].count;

        if (responseCount >= MESSAGES_LIMIT) {
            await this.postToSlack(channel, "🛑 Conversation limit reached.");
            return;
        }

        // 2. Save User Message
        this.ctx.storage.sql.exec(
            `INSERT INTO messages (role, content, timestamp) VALUES (?, ?, ?)`,
            "user", cleanText, Date.now()
        );

        // 3. Retrieve History
        const historyCursor = this.ctx.storage.sql.exec(
            `SELECT role, content FROM messages ORDER BY id DESC LIMIT 10`
        );
        const historyRows = [...historyCursor].reverse();

        const contents = historyRows
            .filter((msg: any) => msg.role !== 'system')
            .map((msg: any) => {
                let role = msg.role;
                if (role === 'assistant') role = 'model';
                if (role !== 'user' && role !== 'model') role = 'model';
                return {
                    role: role,
                    parts: [{ text: msg.content }]
                };
            });

        // 4. RAG Search
        const queryEmbedding = await this.env.AI.run("@cf/baai/bge-base-en-v1.5", {
            text: [cleanText]
        });

        const vecMatches = await this.env.VECTOR_INDEX.query(queryEmbedding.data[0], {
            topK: 5,
            returnMetadata: true
        });

        const contextData = vecMatches.matches
            .map((match: any) => `SOURCE: ${match.metadata.source}\nCONTENT: ${match.metadata.content}`)
            .join("\n\n");

        const systemInstruction = {
            parts: [{
                text: `=== CONTEXT ===\n${STRATEGY_CONTEXT}\n\n=== RETRIEVED KNOWLEDGE ===\n${contextData || "No relevant documents found"}.\n\n ${SYSTEM_INSTRUCTIONS}`
            }]
        };

        // 5. Call Gemini
        const modelVersion = "gemini-2.5-flash"; // Or gemini-1.5-flash
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelVersion}:generateContent?key=${this.env.GEMINI_API_KEY}`;

        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                system_instruction: systemInstruction,
                contents: contents,
                generationConfig: { temperature: 0.7 }
            }),
        });

        const data: any = await response.json();

        // === ERROR FIX 1: Check for candidates before accessing [0] ===
        if (!data.candidates || !data.candidates[0]) {
            console.error("Gemini Text Error:", JSON.stringify(data));
            // Check if it's a safety block
            const errorMsg = data.promptFeedback?.blockReason || data.error?.message || "Unknown API Error";
            await this.postToSlack(channel, `⚠️ I couldn't generate a text reply. Reason: ${errorMsg}`);
            return;
        }

        const textReply = data.candidates[0].content.parts[0].text;

        // 6. Save & Post Reply
        this.ctx.storage.sql.exec(
            `INSERT INTO messages (role, content, timestamp) VALUES (?, ?, ?)`,
            "model", textReply, Date.now()
        );

        await this.postToSlack(channel, textReply, ts);

        // === 2. CONDITIONAL IMAGE GENERATION ===
        if (wantsImage) {
            await this.postToSlack(channel, "🎨 Generating infographic... please wait.", ts);

            try {
                // A. Generate Prompt
                const imagePrompt = await this.createInfographicPrompt(cleanText, textReply);
                console.log("Generated Image Prompt:", imagePrompt);

                // B. Generate Image
                const imageModel = "gemini-2.5-flash-image";
                await this.generateAndUploadImage(imagePrompt, channel, ts, imageModel);

            } catch (err: any) {
                console.error("Image Generation Error:", err);
                await this.postToSlack(channel, `❌ Failed to generate image: ${err.message}`, ts);
            }
        }
    }

    async processSlackFile(file: any, channel: string) {
        const targetUrl = file.url_private;
        console.log(`⬇️ Downloading from: ${targetUrl}`);

        const fileResponse = await fetch(targetUrl, {
            method: "GET",
            headers: { "Authorization": `Bearer ${this.env.SLACK_BOT_TOKEN}` },
            redirect: "follow"
        });

        if (!fileResponse.ok) throw new Error(`Slack download failed: status ${fileResponse.status}`);

        const arrayBuffer = await fileResponse.arrayBuffer();

        // Header Check
        const headerBytes = new Uint8Array(arrayBuffer.slice(0, 5));
        const headerString = new TextDecoder().decode(headerBytes);
        if (headerString !== "%PDF-") {
            throw new Error(`Invalid PDF header: ${headerString}. Check Bot Scopes.`);
        }

        const pdfData = new Uint8Array(arrayBuffer);

        // === PDF FIX: Handle string vs array return types ===
        let text = "";
        try {
            const result = await extractText(pdfData);
            // unpdf extractText usually returns a string, but if it returns an array in some versions:
            text = Array.isArray(result.text) ? result.text.join("\n") : result.text;
        } catch (e: any) {
            throw new Error(`PDF Parsing failed: ${e.message}`);
        }

        if (!text || text.trim().length === 0) throw new Error("PDF text is empty.");

        const chunks = this.splitText(text, 1000, 100);

        for (let i = 0; i < chunks.length; i += 5) {
            const batch = chunks.slice(i, i + 5);
            const { data } = await this.env.AI.run("@cf/baai/bge-base-en-v1.5", { text: batch });

            const vectors = batch.map((chunkText, idx) => ({
                id: `${file.id}-chunk-${i + idx}`,
                values: data[idx],
                metadata: { source: file.title, content: chunkText }
            }));
            await this.env.VECTOR_INDEX.upsert(vectors);
        }
    }

    splitText(text: string, chunkSize: number, overlap: number) {
        const chunks = [];
        let start = 0;
        while (start < text.length) {
            const end = Math.min(start + chunkSize, text.length);
            chunks.push(text.slice(start, end));
            start += chunkSize - overlap;
        }
        return chunks;
    }

    // =========================================
    // HELPER FUNCTIONS
    // =========================================

    async createInfographicPrompt(userQuery: string, factualReply: string): Promise<string> {
        const artDirectorSystemPrompt = `
You are an expert AI Art Director. Create a prompt for an image generation model.
Guidelines:
1. Visual Style: Modern digital infographic, clean blue/purple palette.
2. Content: Visualize the key concepts from the "Factual Reply".
3. Output: ONLY the detailed prompt string.
`;
        const artPrompt = `QUERY: ${userQuery}\nREPLY: ${factualReply}`;

        // Use a stable model for this logic step
        const modelName4ImagePrompt = "gemini-2.5-flash";
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName4ImagePrompt}:generateContent?key=${this.env.GEMINI_API_KEY}`;

        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                system_instruction: { parts: [{ text: artDirectorSystemPrompt }] },
                contents: [{ role: "user", parts: [{ text: artPrompt }] }],
                generationConfig: { temperature: 0.7 },
                // === NEW: DISABLE SAFETY FILTERS ===
                // This is required for topics like DefenseTech or Strategy
                safetySettings: [
                    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
                ]
            }),
        });

        const data: any = await response.json();

        // Debugging: Log the full response to see "promptFeedback" if it fails
        if (!data.candidates || !data.candidates[0]) {
            console.error("Art Director Failed. Full API Response:", JSON.stringify(data, null, 2));

            // Extract the specific reason if available
            const blockReason = data.promptFeedback?.blockReason;
            if (blockReason) {
                throw new Error(`Gemini Safety Block: ${blockReason}. (Try checking Cloudflare logs for details)`);
            }

            throw new Error(`API Error: ${data.error?.message || "Unknown error"}`);
        }

        return data.candidates[0].content.parts[0].text.trim();
    }

    async generateAndUploadImage(
        imagePrompt: string,
        channelId: string,
        threadTs: string,
        modelName: string
    ) {
        const googleImageUrl =
            `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent` +
            `?key=${this.env.GEMINI_API_KEY}`;

        console.log(`Generating image with ${modelName}...`);

        const imageResponse = await fetch(googleImageUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [
                    {
                        parts: [{ text: imagePrompt }]
                    }
                ],
                // Optional, supported for image models to explicitly ask for images
                generationConfig: {
                    response_modalities: ["IMAGE"]
                    // You can add other knobs like temperature here if desired
                }
            })
        });

        if (!imageResponse.ok) {
            const errText = await imageResponse.text();
            throw new Error(
                `Google Image API Error (${imageResponse.status}): ${errText}`
            );
        }

        const imageData: any = await imageResponse.json();

        // Extract first image part (inlineData.data is base64, inlineData.mimeType is e.g. image/png)
        const parts =
            imageData.candidates?.[0]?.content?.parts ??
            imageData.contents?.[0]?.parts ??
            [];
        const imagePart = parts.find((p: any) => p.inlineData || p.inline_data);

        if (!imagePart) {
            console.error("No image part found. Response:", JSON.stringify(imageData));
            throw new Error("API returned success but no image data found.");
        }

        const inline = imagePart.inlineData || imagePart.inline_data;
        const base64Image = inline.data;
        const mimeType = inline.mimeType || inline.mime_type || "image/png";

        if (!base64Image) {
            console.error("No base64 data in inlineData. Response:", JSON.stringify(imageData));
            throw new Error("Image part present but contained no data.");
        }

        const binaryImg = Buffer.from(base64Image, "base64");

        // STEP A: Get Upload URL from Slack
        const getUrlParams = new URLSearchParams({
            filename: "infographic.png",
            length: binaryImg.byteLength.toString()
        });

        const urlRes = await fetch(`https://slack.com/api/files.getUploadURLExternal?${getUrlParams}`, {
            method: "GET",
            headers: { "Authorization": `Bearer ${this.env.SLACK_BOT_TOKEN}` }
        });

        const urlData: any = await urlRes.json();
        if (!urlData.ok) throw new Error(`Slack V2 Step A failed: ${urlData.error}`);

        const { upload_url, file_id } = urlData;

        // STEP B: Upload the actual binary data to the provided URL
        // Note: Do NOT use the Bot Token here. Just raw POST to the specific URL.
        const uploadRes = await fetch(upload_url, {
            method: "POST",
            body: binaryImg
        });

        if (!uploadRes.ok) throw new Error("Slack V2 Step B (Binary Upload) failed");

        // STEP C: Complete the upload and share to channel
        const completeBody: any = {
            files: [{ "id": file_id, "title": "Generated Infographic" }],
            channel_id: channelId
        };

        // Add thread_ts if responding in a thread
        if (threadTs) completeBody.thread_ts = threadTs;

        const completeRes = await fetch("https://slack.com/api/files.completeUploadExternal", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${this.env.SLACK_BOT_TOKEN}`
            },
            body: JSON.stringify(completeBody)
        });

        const completeData: any = await completeRes.json();
        if (!completeData.ok) {
            throw new Error(`Slack V2 Step C failed: ${completeData.error}`);
        }
    }

    async postToSlack(channel: string, text: string, threadTs?: string) {
        const body: any = { channel, text };
        if (threadTs) body.thread_ts = threadTs;

        await fetch("https://slack.com/api/chat.postMessage", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${this.env.SLACK_BOT_TOKEN}`,
            },
            body: JSON.stringify(body),
        });
    }
}