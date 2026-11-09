import { buildAgentText, LIMIT, originOf, parseUpdates } from "@/lib/core";
import { readBody } from "@/lib/http";
import { agentContext, applyUpdates, rateLimit } from "@/lib/store";

type Params = { params: Promise<{ token: string }> };

function plain(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
      "referrer-policy": "no-referrer",
    },
  });
}

export async function GET(req: Request, { params }: Params) {
  const ctx = await agentContext((await params).token);
  return ctx ? plain(buildAgentText(ctx, originOf(req.headers))) : plain("Not found", 404);
}

export async function POST(req: Request, { params }: Params) {
  const { token } = await params;
  const ctx = await agentContext(token);
  if (!ctx) return plain("Not found", 404);
  if (!(await rateLimit(`agent:${token}`, 30, 600_000))) return plain("Too many requests", 429);
  const body = await readBody(req, LIMIT.body);
  if (body === null) return plain("Body exceeds 20,000 characters", 413);
  const blocks = parseUpdates(body);
  if (!blocks.length) return plain("No IGLOO UPDATE blocks found", 400);
  const results = await applyUpdates(ctx.me, blocks);
  const saved = results.filter((result) => result.ok).length;
  const lines = results.map(({ task, ok, message }) => `${ok ? "saved" : "skipped"}: ${task}: ${message}`);
  return plain([...lines, `${saved} of ${results.length} saved`].join("\n"), saved ? 200 : 422);
}
