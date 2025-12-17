// src/chatRoom.ts
import { DurableObject } from "cloudflare:workers";
import { Env } from "./index";
import { STRATEGY_CONTEXT, SYSTEM_INSTRUCTIONS } from "./knowledge";
import { MESSAGES_LIMIT } from "./const.js";

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
        const { text, channel } = event;

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
        const cleanText = text.replace(/<@[a-zA-Z0-9]+>/g, "").trim();

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

        // 4. Construct System Instruction
        const systemInstruction = {
            parts: [{ text: `${SYSTEM_INSTRUCTIONS}\n\n=== CONTEXT ===\n${STRATEGY_CONTEXT}` }]
        };

        // 5. Call Gemini 2.5 Flash API
        // UPDATED MODEL STRING HERE:
        const modelVersion = "gemini-2.5-flash"; // Change to "gemini-1.5-flash" if 2.5 is not available
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelVersion}:generateContent?key=${this.env.GEMINI_API_KEY}`;

        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                system_instruction: systemInstruction,
                contents: contents,
                generationConfig: {
                    temperature: 0.3,
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

        const reply = data.candidates[0].content.parts[0].text;

        // 6. Save Assistant Response (Role = 'model')
        this.ctx.storage.sql.exec(
            `INSERT INTO messages (role, content, timestamp) VALUES (?, ?, ?)`,
            "model", reply, Date.now()
        );

        // 7. Post to Slack
        await this.postToSlack(channel, reply);
    }

    async postToSlack(channel: string, text: string) {
        await fetch("https://slack.com/api/chat.postMessage", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${this.env.SLACK_BOT_TOKEN}`,
            },
            body: JSON.stringify({ channel, text }),
        });
    }
}