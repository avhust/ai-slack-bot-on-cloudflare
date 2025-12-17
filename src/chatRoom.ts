// src/chatRoom.ts
import { DurableObject } from "cloudflare:workers";
import { Env } from "./index";
import { STRATEGY_CONTEXT, SYSTEM_INSTRUCTIONS } from "./knowledge"; // Import the text

export class ChatRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Initialize DB schema if not exists
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
    const { text, channel, user } = event;

    // 1. Check Response Limit
    const countResult = this.ctx.storage.sql.exec(
      `SELECT COUNT(*) as count FROM messages WHERE role = 'assistant'`
    );
    // @ts-ignore - raw result handling depends on specific driver version, usually an iterator or array
    const responseCount: number = [...countResult][0].count;

    if (responseCount >= 100) {
      await this.postToSlack(channel, "🛑 Conversation limit of 100 responses reached. Please start a new channel.");
      return;
    }

    // 2. Save User Message
    this.ctx.storage.sql.exec(
      `INSERT INTO messages (role, content, timestamp) VALUES (?, ?, ?)`,
      "user", text, Date.now()
    );

    // 3. Retrieve Context (Last 10 messages for context window)
    const historyCursor = this.ctx.storage.sql.exec(
      `SELECT role, content FROM messages ORDER BY id DESC LIMIT 10`
    );
    const history = [...historyCursor].reverse();

    // 4. Call ChatGPT
    // const systemPrompt = { role: "system", content: "You are a helpful Slack bot." };
    const messages = [{
      role: "system",
      content: `${SYSTEM_INSTRUCTIONS}\n\n=== CONTEXT START ===\n${STRATEGY_CONTEXT}\n=== CONTEXT END ===`
    }, ...history];

    const openAiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages,
        temperature: 0.3, // Lower temperature = more deterministic / less creative
      }),
    });

    const data: any = await openAiResponse.json();
    const reply = data.choices[0].message.content;

    // 5. Save Assistant Response
    this.ctx.storage.sql.exec(
      `INSERT INTO messages (role, content, timestamp) VALUES (?, ?, ?)`,
      "assistant", reply, Date.now()
    );

    // 6. Post back to Slack
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