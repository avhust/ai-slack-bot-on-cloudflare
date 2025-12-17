// src/chatRoom.ts
import { DurableObject } from "cloudflare:workers";
import { Env } from "./index";
import { STRATEGY_CONTEXT, SYSTEM_INSTRUCTIONS } from "./knowledge";
import { MESSAGES_LIMIT } from "./const.js";
import { extractText } from "unpdf"; // Import PDF parser

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
            return; // Stop here, don't send files to Gemini as chat text
        }

        // === 1. Detect Image Request & Clean Text ===
        const wantsImage = text.includes("[IMAGE]");
        // Remove the tag so it doesn't confuse the RAG search
        const cleanText = text.replace("[IMAGE]", "").replace(/<@[a-zA-Z0-9]+>/g, "").trim();

        // 1. Check Limit (Same as before)
        const countResult = this.ctx.storage.sql.exec(
            `SELECT COUNT(*) as count FROM messages WHERE role = 'model'`
        );
        // @ts-ignore
        const responseCount: number = [...countResult][0].count;

        if (responseCount >= MESSAGES_LIMIT) {
            await this.postToSlack(channel, "🛑 Conversation limit reached.");
            return;
        }
        // 2. Clean Input & Save User Message

        this.ctx.storage.sql.exec(
            `INSERT INTO messages (role, content, timestamp) VALUES (?, ?, ?)`,
            "user", cleanText, Date.now()
        );

        // 3. Retrieve History & Fix Roles
        const historyCursor = this.ctx.storage.sql.exec(
            `SELECT role, content FROM messages ORDER BY id DESC LIMIT 10`
        );
        const historyRows = [...historyCursor].reverse();

        // Map to Gemini structure, ensuring strict 'user' vs 'model' roles
        const contents = historyRows
            .filter((msg: any) => msg.role !== 'system')
            .map((msg: any) => {
                let role = msg.role;
                // Map old 'assistant' messages to 'model'
                if (role === 'assistant') role = 'model';
                // Fallback for safety
                if (role !== 'user' && role !== 'model') role = 'model';

                return {
                    role: role,
                    parts: [{ text: msg.content }]
                };
            });


        const queryEmbedding = await this.env.AI.run("@cf/baai/bge-base-en-v1.5", {
            text: [text]
        });

        // 2. Query Vectorize
        const vecMatches = await this.env.VECTOR_INDEX.query(queryEmbedding.data[0], {
            topK: 3, // Get top 3 most relevant PDF chunks
            returnMetadata: true // We need the text back
        });

        // 3. Build Context String from matches
        const contextData = vecMatches.matches
            .map((match: any) => `SOURCE: ${match.metadata.source}\nCONTENT: ${match.metadata.content}`)
            .join("\n\n");
        console.log("📚 Retrieved Context:\n", contextData);
        const systemInstruction = {
            parts: [{
                text: `=== INITIAL CONTEXT ===\n${STRATEGY_CONTEXT}\n\n=== RETRIEVED KNOWLEDGE ===\n${contextData || "No relevant documents found"}.\n\n ${SYSTEM_INSTRUCTIONS}\n\n"}`
            }]
        };

        // 4. Construct System Instruction
        // const systemInstruction = {
        //     parts: [{ text: `${SYSTEM_INSTRUCTIONS}\n\n=== CONTEXT ===\n${STRATEGY_CONTEXT}` }]
        // };

        // 5. Call Gemini 2.5 Flash API
        // UPDATED MODEL STRING HERE:
        // const modelVersion = "gemini-3-flash-preview"; // Change to "gemini-1.5-flash" if 2.5 is not available
        const modelVersion = "gemini-2.5-flash"; // Change to "gemini-1.5-flash" if 2.5 is not available
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelVersion}:generateContent?key=${this.env.GEMINI_API_KEY}`;

        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                system_instruction: systemInstruction,
                contents: contents,
                generationConfig: {
                    temperature: 0.9,
                }
            }),
        });

        const data: any = await response.json();

        // Error handling in case Gemini refuses or errors out
        if (!data.candidates || data.candidates.length === 0) {
            console.error("Gemini Error:", JSON.stringify(data));
            await this.postToSlack(channel, "⚠️ I encountered an error processing that request.");
            return;
        }

        // const reply = data.candidates[0].content.parts[0].text;
        const textReply = data.candidates[0].content.parts[0].text;

        // 6. Save Assistant Response (Role = 'model')
        this.ctx.storage.sql.exec(
            `INSERT INTO messages (role, content, timestamp) VALUES (?, ?, ?)`,
            "model", textReply, Date.now()
        );

        // 7. Post to Slack
        await this.postToSlack(channel, textReply);

        // === 2. CONDITIONAL IMAGE GENERATION ===
        if (wantsImage) {
            // Notify user that image is generating (it takes longer)
            await this.postToSlack(channel, "🎨 Generating infographic... please wait.", ts);

            try {
                // A. Generate the prompt for the image
                const imagePrompt = await this.createInfographicPrompt(cleanText, textReply);
                console.log("Generated Image Prompt:", imagePrompt);

                // B. Generate and upload the image
                // Using a currently available image model string. Update to 2.5 when available.
                const imageModel = "imagen-3.0-generate-001";
                await this.generateAndUploadImage(imagePrompt, channel, ts, imageModel);

            } catch (err: any) {
                console.error("Image Generation Error:", err);
                await this.postToSlack(channel, `❌ Failed to generate image: ${err.message}`, ts);
            }
        }

    }

    async processSlackFile(file: any, channel: string) {
        // 1. CHOOSE URL: 'url_private' is often more reliable for Bots than 'url_private_download'
        // We try url_private first as it works better with Bearer tokens in headers
        const targetUrl = file.url_private;

        console.log(`⬇️ Downloading from: ${targetUrl}`);

        // 2. FETCH WITH STRICT HEADERS
        const fileResponse = await fetch(targetUrl, {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${this.env.SLACK_BOT_TOKEN}`
            },
            redirect: "follow" // Essential: Follow Slack's CDN redirects
        });

        if (!fileResponse.ok) {
            throw new Error(`Slack download failed: status ${fileResponse.status}`);
        }

        // 3. DEBUG: Check what we actually got
        const contentType = fileResponse.headers.get("Content-Type");
        console.log(`🔎 Content-Type received: ${contentType}`);

        // 4. READ AS BUFFER
        const arrayBuffer = await fileResponse.arrayBuffer();

        // 5. CRITICAL CHECK: Verify Magic Bytes (%PDF)
        // This looks at the first 5 bytes of the file. 
        // A real PDF *always* starts with "%PDF-"
        const headerBytes = new Uint8Array(arrayBuffer.slice(0, 5));
        const headerString = new TextDecoder().decode(headerBytes);

        if (headerString !== "%PDF-") {
            // If we see "<!DOC" or "<html", we know it's an auth error page
            console.error(`❌ Invalid Header: '${headerString}'`);
            throw new Error(
                `Download verification failed. Expected '%PDF-' but got '${headerString}'. ` +
                `This is usually an HTML Login page. Check your SLACK_BOT_TOKEN scopes.`
            );
        }

        // 6. NOW it is safe to parse
        const pdfData = new Uint8Array(arrayBuffer);

        // Wrap unpdf in a try/catch block for corrupt files
        let text = "";
        try {
            const result = await extractText(pdfData);
            text = result.text.join("\n");
        } catch (e: any) {
            throw new Error(`PDF Parsing failed: ${e.message}`);
        }

        if (!text || text.trim().length === 0) {
            throw new Error("PDF text is empty. It might be a scanned image.");
        }

        console.log(`✅ Text Extracted: ${text.length} chars`);

        // 7. Chunk and Save (Existing Logic)
        const chunks = this.splitText(text, 1000, 100);

        for (let i = 0; i < chunks.length; i += 5) {
            const batch = chunks.slice(i, i + 5);

            // Generate Embeddings
            const { data } = await this.env.AI.run("@cf/baai/bge-base-en-v1.5", {
                text: batch
            });

            // Save to Vector DB
            const vectors = batch.map((chunkText, idx) => ({
                id: `${file.id}-chunk-${i + idx}`,
                values: data[idx],
                metadata: {
                    source: file.title,
                    content: chunkText
                }
            }));

            await this.env.VECTOR_INDEX.upsert(vectors);
        }
    }

    // Simple Splitter Helper
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
    // NEW HELPER FUNCTIONS
    // =========================================

    /**
     * Uses the text Gemini model to act as an "Art Director", creating a
     * detailed visual description based on the factual text reply.
     */
    async createInfographicPrompt(userQuery: string, factualReply: string): Promise<string> {
        const artDirectorSystemPrompt = `
You are an expert AI Art Director specializing in educational infographics.
Your goal is to take a textual explanation and translate it into a detailed, visually rich prompt for an image generation model.

Guidelines:
1.  **Visual Style:** Clean, modern digital infographic style. Use a professional color palette (blues, purples, unobtrusive greys).
2.  **Structure:** Use visual metaphors like flowcharts, connected boxes, contrasting columns, or central hub diagrams depending on the content.
3.  **Text in Image:** You MUST include specific, short, accurate text labels inside the description that should appear in the image.
4.  **Accuracy:** The visual elements must accurately reflect the provided factual reply.

Identify the key concepts in the "Factual Reply" and design a visual layout that explains them.
Output ONLY the final detailed image prompt string.
`;

        const artPrompt = `
USER QUERY: ${userQuery}
FACTUAL REPLY: ${factualReply}

Create the detailed image generation prompt now:
`;

        // We use a fast, cheap model for this intermediate step
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${this.env.GEMINI_API_KEY}`;
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                system_instruction: { parts: [{ text: artDirectorSystemPrompt }] },
                contents: [{ role: "user", parts: [{ text: artPrompt }] }],
                generationConfig: { temperature: 0.7 } // Slightly higher temp for creativity in layout
            }),
        });
        const data: any = await response.json();
        return data.candidates[0].content.parts[0].text.trim();
    }


    /**
     * Calls Google's Image API, gets base64 data, turns it into a file, 
     * and uploads it to Slack.
     */
    async generateAndUploadImage(imagePrompt: string, channelId: string, threadTs: string, modelName: string) {
        // 1. Call Google Image Generation API
        // Note: The API endpoint and payload structure for image generation often differs from text.
        // This uses the structure common for Imagen on Vertex/AI Studio REST API.
        const googleImageUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:predict?key=${this.env.GEMINI_API_KEY}`;
        
        const imageResponse = await fetch(googleImageUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                instances: [{ prompt: imagePrompt }],
                parameters: {
                    sampleCount: 1,
                    aspectRatio: "16:9" // Good for infographics
                }
            })
        });

        if (!imageResponse.ok) {
            const errText = await imageResponse.text();
            throw new Error(`Google Image API failed: ${imageResponse.status} - ${errText}`);
        }

        const imageData: any = await imageResponse.json();
        // Google usually returns base64 image data in this structure
        const base64Image = imageData.predictions?.[0]?.bytesBase64;

        if (!base64Image) {
            throw new Error("No image data found in Google API response");
        }

        // 2. Convert Base64 to Binary Buffer for upload
        // We need to use Cloudflare's Buffer global (requires nodejs_compat flag in wrangler.toml)
        const binaryImg = Buffer.from(base64Image, 'base64');

        // 3. Upload to Slack
        // Slack requires multipart/form-data for file uploads
        const formData = new FormData();
        formData.append("token", this.env.SLACK_BOT_TOKEN);
        formData.append("channels", channelId);
        // Use a Blob to append the binary data with filename and type
        formData.append("file", new Blob([binaryImg], { type: 'image/png' }), "infographic.png");
        formData.append("title", "Generated Infographic");
        if (threadTs) formData.append("thread_ts", threadTs); // Keep it in the thread

        const slackUploadReq = await fetch("https://slack.com/api/files.upload", {
            method: "POST",
            // Do NOT set Content-Type header manually; fetch sets boundary automatically for FormData
            body: formData
        });

        const slackResponse: any = await slackUploadReq.json();
        if (!slackResponse.ok) {
            throw new Error(`Slack upload failed: ${slackResponse.error}`);
        }
    }

    // async postToSlack(channel: string, text: string) {
    //     await fetch("https://slack.com/api/chat.postMessage", {
    //         method: "POST",
    //         headers: {
    //             "Content-Type": "application/json",
    //             "Authorization": `Bearer ${this.env.SLACK_BOT_TOKEN}`,
    //         },
    //         body: JSON.stringify({ channel, text }),
    //     });
    // }

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