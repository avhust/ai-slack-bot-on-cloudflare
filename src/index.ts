// src/index.ts
import { WorkerEntrypoint } from "cloudflare:workers";

export interface Env {
  CHAT_DO: DurableObjectNamespace;
  SLACK_SIGNING_SECRET: string;
  SLACK_BOT_TOKEN: string;
  OPENAI_API_KEY: string;
  GEMINI_API_KEY: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

    const body = await request.text();

    // 1. Handle Slack URL Verification (Challenge)
    const { type, challenge, event } = JSON.parse(body);
    if (type === "url_verification") {
      return new Response(JSON.stringify({ challenge }), {
        headers: { "content-type": "application/json" },
      });
    }

    // 2. Verify Request Signature (Security)
    // IMPORTANT: Implement verifySlackSignature here (omitted for brevity, see Slack docs)
    // if (!await verifySlackSignature(request, body, env.SLACK_SIGNING_SECRET)) {
    //   return new Response("Unauthorized", { status: 401 });
    // }

    // 3. Prevent bot recursion
    if (event?.bot_id || type !== "event_callback") {
      return new Response("Ignored");
    }

    // 4. Route to Durable Object based on Channel or Thread ID
    // We use the channel ID as the unique ID for the DO.
    const id = env.CHAT_DO.idFromName(event.channel);
    const stub = env.CHAT_DO.get(id);

    // 5. Asynchronously process the message so we can return 200 OK instantly
    ctx.waitUntil(stub.handleMessage(event));

    return new Response("OK");
  },
};

// Re-export the Durable Object class so Cloudflare finds it
export { ChatRoom } from "./chatRoom_gemini.js";
// export { ChatRoom } from "./chatRoom_openai.js";