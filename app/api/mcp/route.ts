import { buildAgentText, FILE_ACCEPT, FILE_LIMIT, LIMIT, matchTask, originOf, type AgentContext } from "@/lib/core";
import { readBody } from "@/lib/http";
import { addNote, agentContext, applyUpdates, claimTask, rateLimit, shareFile } from "@/lib/store";

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
  {
    name: "upload_file",
    description: `Share a file with the group (up to 2 MB; ${FILE_ACCEPT}). Send text files as plain text, and PDF, PowerPoint or Word files as base64.`,
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", minLength: 1, maxLength: 160, description: "File name with its extension, such as api.ts or deck.pptx" },
        content: { type: "string", description: "The file's contents" },
        encoding: { type: "string", enum: ["text", "base64"], description: "How content is written. Defaults to text." },
        task: { ...title, description: "Optional task title to attach the file to" },
      },
      required: ["name", "content"],
    },
  },
];
// A 2 MB file is about 2.8 million characters as base64, plus the JSON around it.
const BODY_LIMIT = 3_000_000;

const headers = { "cache-control": "no-store", "x-robots-tag": "noindex", "referrer-policy": "no-referrer" };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const validText = (v: unknown, max: number): v is string => typeof v === "string" && !!v.trim() && v.length <= max;
const reply = (text: string, isError = false) => ({ content: [{ type: "text", text }], ...(isError ? { isError } : {}) });

async function callTool(ctx: AgentContext, name: string, args: Record<string, unknown>, origin: string) {
  switch (name) {
    case "get_context":
      return reply(buildAgentText(ctx, origin));
    case "list_tasks":
      return reply(JSON.stringify(ctx.tasks.map(({ title, phase, status, owner_member_id }) => ({
        title, phase, status,
        owner: owner_member_id === ctx.me.id ? "me" : ctx.members.find((m) => m.id === owner_member_id)?.name ?? null,
      }))));
    case "claim_task": {
      if (!validText(args.task, LIMIT.title)) return reply("Provide a valid task title", true);
      const task = matchTask(ctx.tasks, args.task.trim());
      if (!task) return reply("No task with that title", true);
      const result = await claimTask(ctx.me, task.id);
      return result.error ? reply(result.error, true) : reply(result.ok ?? "");
    }
    case "update_task": {
      const { task, status, note } = args;
      if (!validText(task, LIMIT.title) || (status !== "doing" && status !== "done") ||
          (note !== undefined && !validText(note, LIMIT.note))) return reply("Invalid task, status or note", true);
      const [result] = await applyUpdates(ctx.me, [{ task: task.trim(), status, note }]);
      return reply(result.message, !result.ok);
    }
    case "upload_file": {
      const { name, content, encoding = "text", task } = args;
      if (!validText(name, 160) || typeof content !== "string" || (encoding !== "text" && encoding !== "base64") ||
          (task !== undefined && !validText(task, LIMIT.title))) return reply("Invalid name, content, encoding or task", true);
      if (encoding === "base64" && !/^[A-Za-z0-9+/]*={0,2}$/.test(content.replace(/\s+/g, ""))) return reply("Content is not valid base64", true);
      const bytes = Buffer.from(encoding === "base64" ? content.replace(/\s+/g, "") : content, encoding === "base64" ? "base64" : "utf8");
      if (!bytes.length || bytes.length > FILE_LIMIT) return reply("Choose a file between 1 byte and 2 MB", true);
      const linked = task === undefined ? undefined : matchTask(ctx.tasks, task.trim());
      if (task !== undefined && !linked) return reply("No task with that title", true);
      if (!(await rateLimit(`upload:${ctx.me.id}`, 12, 600_000))) return reply("Too many uploads. Try again shortly.", true);
      const result = await shareFile(ctx.me, new File([bytes], name.trim()), linked?.id ?? "");
      return result.error ? reply(result.error, true) : reply(`${result.ok}: ${name.trim()}${linked ? ` (task: ${linked.title})` : ""}`);
    }
    case "add_note": {
      if (!validText(args.text, LIMIT.note)) return reply("Provide a note of up to 280 characters", true);
      const result = await addNote(ctx.me, args.text);
      return result.error ? reply(result.error, true) : reply(result.ok ?? "");
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
  const body = await readBody(req, BODY_LIMIT);
  if (body === null) return error(-32600, "Body exceeds 3,000,000 characters", 413);
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
