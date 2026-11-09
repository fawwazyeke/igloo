import { buildAgentText, LIMIT, matchTask, originOf, type AgentContext } from "@/lib/core";
import { readBody } from "@/lib/http";
import { addNote, agentContext, applyUpdates, claimTask, rateLimit } from "@/lib/store";

const versions = ["2025-06-18", "2025-03-26", "2024-11-05"];
const title = { type: "string", minLength: 1, maxLength: LIMIT.title };
const note = { type: "string", minLength: 1, maxLength: LIMIT.note };
const tools = [
  { name: "get_context", description: "Read the project context. Call this first.", inputSchema: { type: "object" } },
  { name: "list_tasks", description: "List tasks with their phase, status and owner.", inputSchema: { type: "object" } },
  {
    name: "claim_task", description: "Claim an unclaimed task by title.",
    inputSchema: { type: "object", properties: { task: title }, required: ["task"] },
  },
  {
    name: "update_task", description: "Start or finish a task and optionally add a note.",
    inputSchema: {
      type: "object", properties: { task: title, status: { type: "string", enum: ["doing", "done"] }, note },
      required: ["task", "status"],
    },
  },
  {
    name: "add_note", description: "Share a short note with the group.",
    inputSchema: { type: "object", properties: { text: note }, required: ["text"] },
  },
];

const headers = { "cache-control": "no-store", "x-robots-tag": "noindex", "referrer-policy": "no-referrer" };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const validText = (v: unknown, max: number): v is string => typeof v === "string" && !!v.trim() && v.length <= max;
const content = (text: string, isError = false) => ({ content: [{ type: "text", text }], ...(isError ? { isError } : {}) });

async function callTool(ctx: AgentContext, name: string, args: Record<string, unknown>, origin: string) {
  switch (name) {
    case "get_context":
      return content(buildAgentText(ctx, origin));
    case "list_tasks":
      return content(JSON.stringify(ctx.tasks.map(({ title, phase, status, owner_member_id }) => ({
        title, phase, status,
        owner: owner_member_id === ctx.me.id ? "me" : ctx.members.find((m) => m.id === owner_member_id)?.name ?? null,
      }))));
    case "claim_task": {
      if (!validText(args.task, LIMIT.title)) return content("Provide a valid task title", true);
      const task = matchTask(ctx.tasks, args.task.trim());
      if (!task) return content("No task with that title", true);
      const result = await claimTask(ctx.me, task.id);
      return result.error ? content(result.error, true) : content(result.ok ?? "");
    }
    case "update_task": {
      const { task, status, note } = args;
      if (!validText(task, LIMIT.title) || (status !== "doing" && status !== "done") ||
          (note !== undefined && !validText(note, LIMIT.note))) return content("Invalid task, status or note", true);
      const [result] = await applyUpdates(ctx.me, [{ task: task.trim(), status, note }]);
      return content(result.message, !result.ok);
    }
    case "add_note": {
      if (!validText(args.text, LIMIT.note)) return content("Provide a note of up to 280 characters", true);
      const result = await addNote(ctx.me, args.text);
      return result.error ? content(result.error, true) : content(result.ok ?? "");
    }
  }
}

export function GET() {
  return new Response(null, { status: 405, headers: { ...headers, Allow: "POST" } });
}

export async function POST(req: Request) {
  let id: string | number | null = null;
  const error = (code: number, message: string, status = 200) =>
    Response.json({ jsonrpc: "2.0", id, error: { code, message } }, { status, headers });
  const success = (result: unknown) => Response.json({ jsonrpc: "2.0", id, result }, { headers });
  const origin = originOf(req.headers);
  const source = req.headers.get("origin");
  if (source !== null && source !== origin) return error(-32000, "Origin forbidden", 403);
  const auth = req.headers.get("authorization");
  const token = auth === null ? new URL(req.url).searchParams.get("token") : /^Bearer (\S+)$/i.exec(auth)?.[1];
  const ctx = await agentContext(token ?? "");
  if (!ctx) return error(-32000, "Invalid or missing agent token", 401);
  const version = req.headers.get("mcp-protocol-version");
  if (version && !versions.includes(version)) return error(-32600, "Unsupported protocol version", 400);
  const body = await readBody(req, LIMIT.body);
  if (body === null) return error(-32600, "Body exceeds 20,000 characters", 413);
  let message: unknown;
  try { message = JSON.parse(body); } catch { return error(-32700, "Parse error", 400); }
  if (!object(message) || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return error(-32600, "Invalid request", 400);
  }
  if (!Object.hasOwn(message, "id")) return new Response(null, { status: 202, headers });
  if (typeof message.id !== "string" && typeof message.id !== "number") return error(-32600, "Invalid id", 400);
  id = message.id;
  const params = message.params ?? {};
  if (!object(params)) return error(-32602, "Invalid params");
  switch (message.method) {
    case "initialize":
      return success({
        protocolVersion: typeof params.protocolVersion === "string" && versions.includes(params.protocolVersion)
          ? params.protocolVersion : versions[0],
        capabilities: { tools: {} }, serverInfo: { name: "igloo", version: "1.0.0" },
      });
    case "ping":
      return success({});
    case "tools/list":
      return success({ tools });
    case "tools/call": {
      if (!(await rateLimit(`mcp:${ctx.me.agent_token}`, 60, 600_000))) return error(-32000, "Too many requests", 429);
      const args = params.arguments ?? {};
      if (typeof params.name !== "string" || !object(args)) return error(-32602, "Invalid tool call");
      const result = await callTool(ctx, params.name, args, origin);
      return result ? success(result) : error(-32602, "Unknown tool");
    }
    default:
      return error(-32601, "Method not found");
  }
}
