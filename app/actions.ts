"use server";
// Every export here is a public endpoint. Only export real actions; keep helpers unexported.
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import * as store from "@/lib/store";
import { LIMIT, PHASES, parseTaskLines, parseUpdates, type Member, type Phase, type Result, type Status } from "@/lib/core";

type FormState = { error?: string } | undefined;
const cookieName = (slug: string) => `gm_${slug}`;
const validSlug = (v: unknown): v is string => typeof v === "string" && /^[a-z0-9-]{1,60}$/.test(v);
async function ip() {
  const h = await headers();
  return (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "local";
}

// ---------- Before joining ----------
export async function createProject(_: FormState, f: FormData): Promise<FormState> {
  if (!(await store.rateLimit(`create:${await ip()}`, 10, 3_600_000))) return { error: "Too many new projects. Try again in an hour." };
  const r = await store.createProject({
    name: String(f.get("name") ?? ""), context: String(f.get("context") ?? ""), due: String(f.get("due") ?? ""),
    brief: String(f.get("brief") ?? ""), tasks: parseTaskLines(String(f.get("tasks") ?? "").slice(0, LIMIT.taskText)),
  });
  if ("error" in r) return { error: r.error };
  redirect(`/p/${r.slug}?code=${r.code}`);
}

export async function joinProject(_: FormState, f: FormData): Promise<FormState> {
  const slug = f.get("slug");
  if (!validSlug(slug)) return { error: "This group doesn't exist" };
  if (!(await store.rateLimit(`join:${await ip()}:${slug}`, 10, 600_000))) return { error: "Too many tries. Wait 10 minutes." };
  const r = await store.joinProject(slug, { name: String(f.get("name") ?? ""), ai_tool: String(f.get("ai_tool") ?? ""), code: String(f.get("code") ?? "").trim() });
  if (!r.session) return { error: r.error };
  (await cookies()).set(cookieName(slug), r.session, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 90 * 86400,
  });
  redirect(`/p/${slug}`);
}

// "Switch": forget who this device is. The member stays in the group.
export async function leaveDevice(f: FormData) {
  const slug = f.get("slug");
  if (!validSlug(slug)) return;
  (await cookies()).delete(cookieName(slug));
  redirect(`/p/${slug}`);
}

// ---------- For members ----------
async function asMember<T>(slug: unknown, fn: (me: Member) => Promise<T>): Promise<T | { error: string }> {
  if (!validSlug(slug)) return { error: "This group doesn't exist" };
  const me = await store.memberBySession(slug, (await cookies()).get(cookieName(slug))?.value);
  if (!me) return { error: "Please join the group first" };
  const r = await fn(me);
  revalidatePath(`/p/${slug}`);
  return r;
}
const str = (v: unknown) => (typeof v === "string" ? v : "");

export async function claim(slug: string, taskId: string): Promise<Result> {
  return asMember(slug, (me) => store.claimTask(me, str(taskId)));
}
export async function setStatus(slug: string, taskId: string, status: Status): Promise<Result> {
  return asMember(slug, (me) => store.setTaskStatus(me, str(taskId), status));
}
export async function unclaim(slug: string, taskId: string): Promise<Result> {
  return asMember(slug, (me) => store.unclaimTask(me, str(taskId)));
}
export async function reassign(slug: string, taskId: string, memberId: string): Promise<Result> {
  return asMember(slug, (me) => store.reassignTask(me, str(taskId), str(memberId)));
}
export async function setDue(slug: string, taskId: string, due: string | null): Promise<Result> {
  return asMember(slug, (me) => store.setTaskDue(me, str(taskId), due === null ? null : str(due)));
}
export async function addTask(slug: string, title: string, phase: Phase): Promise<Result> {
  return asMember(slug, (me) => store.addTask(me, str(title), PHASES.includes(phase) ? phase : "build"));
}
export async function proposeDecision(slug: string, text: string): Promise<Result> {
  return asMember(slug, (me) => store.proposeDecision(me, str(text)));
}
export async function approveDecision(slug: string, id: string): Promise<Result> {
  return asMember(slug, (me) => store.approveDecision(me, str(id)));
}

// Paste back: the human pastes their AI's reply.
export async function saveUpdates(slug: string, text: string): Promise<Result & { results?: store.BlockResult[] }> {
  return asMember(slug, async (me) => {
    if (!(await store.rateLimit(`paste:${me.id}`, 30, 600_000))) return { error: "Too many saves. Wait a few minutes." };
    const blocks = parseUpdates(str(text).slice(0, LIMIT.body));
    if (!blocks.length) return { error: "No IGLOO UPDATE blocks found" };
    const results = await store.applyUpdates(me, blocks);
    const saved = results.filter((r) => r.ok).length;
    return saved ? { ok: `Saved ${saved} update${saved > 1 ? "s" : ""}`, results } : { error: "Nothing saved", results };
  });
}

// Live updates: the newest activity id. Members only.
export async function pulse(slug: string): Promise<number | null> {
  if (!validSlug(slug)) return null;
  const me = await store.memberBySession(slug, (await cookies()).get(cookieName(slug))?.value);
  return me ? store.latestActivityId(slug) : null;
}
