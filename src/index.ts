// src/index.ts
import { ChatRoom } from "./chatRoom_gemini.js";

export interface Env {
  CHAT_DO: DurableObjectNamespace;
  SLACK_SIGNING_SECRET: string;
  SLACK_BOT_TOKEN: string;
  OPENAI_API_KEY: string;
  GEMINI_API_KEY: string;
  VECTOR_INDEX: VectorizeIndex;
  AI: any;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // const url = new URL(request.url);

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const body = await request.text();

    // 1. Handle Slack URL Verification (Challenge)
    const { type, challenge, event } = JSON.parse(body);
    if (type === "url_verification") {
      return new Response(JSON.stringify({ challenge }), {
        headers: { "content-type": "application/json" },
      });
    }

    // 2. Prevent bot recursion
    if (event?.bot_id || type !== "event_callback") {
      return new Response("Ignored");
    }

    // 3. Route to Durable Object based on Channel ID
    const id = env.CHAT_DO.idFromName(event.channel);
    // const stub = env.CHAT_DO.get(id);
    const stub = env.CHAT_DO.get(id) as DurableObjectStub<ChatRoom>

    // 4. Asynchronously process the message
    ctx.waitUntil(stub.handleMessage(event));

    return new Response("OK");
  },
};

// Re-export the Durable Object class
export { ChatRoom } from "./chatRoom_gemini.js";