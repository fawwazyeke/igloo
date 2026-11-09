// Storage and every write rule. Server only. The UI (server actions), agent POST and MCP all call these.
// Backend: a local JSON file. Each change is one synchronous read, modify, write, so nothing can run
// between a check and its write inside one Node process (claims are atomic).
// Postgres comes later behind the same async functions (docs/PLAN.md, milestone B).
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  COLORS, LIMIT, PHASES, clean, cleanText, isCode, isDate, isToken, matchTask, publicMember,
  type Activity, type AgentContext, type Decision, type Member, type Note, type Phase,
  type Project, type Result, type Status, type Task, type TaskNote, type UpdateBlock,
} from "./core";

type DB = { projects: Project[]; members: Member[]; tasks: Task[]; decisions: Decision[]; notes: Note[]; activity: Activity[]; seq: number };
const empty = (): DB => ({ projects: [], members: [], tasks: [], decisions: [], notes: [], activity: [], seq: 0 });
const file = () => resolve(process.env.IGLOO_DATA_FILE ?? "data/db.json");

function load(): DB {
  try { return { ...empty(), ...JSON.parse(readFileSync(file(), "utf8")) }; } catch { return empty(); }
}
function tx<T>(fn: (db: DB) => T): T {
  const db = load();
  const out = fn(db);
  const f = file();
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f + ".tmp", JSON.stringify(db));
  renameSync(f + ".tmp", f);
  return out;
}

const now = () => new Date().toISOString();
const token = () => randomBytes(32).toString("hex");
// task_id links an event to its task, for the task's own history on its card.
function log(db: DB, project_id: string, member_id: string | null, kind: string, message: string, task_id?: string) {
  db.activity.push({ id: ++db.seq, project_id, member_id, kind, message, created_at: now(), ...(task_id ? { task_id } : {}) });
}
const nameOf = (db: DB, id: string | null) => db.members.find((m) => m.id === id)?.name ?? "Someone";
const findTask = (db: DB, me: Member, id: string) => db.tasks.find((t) => t.id === id && t.project_id === me.project_id);
// Always act on the stored member, never on a copy the caller kept.
const live = (db: DB, me: Member) => {
  const m = db.members.find((x) => x.id === me.id);
  if (m) m.last_seen_at = now();
  return m;
};
const gone: Result = { error: "You are no longer in this group" };

// ---------- Rate limits (in memory for now; shared table in milestone C) ----------
const hits = new Map<string, number[]>();
export async function rateLimit(key: string, max: number, windowMs: number) {
  const t = Date.now();
  const list = (hits.get(key) ?? []).filter((x) => t - x < windowMs);
  if (list.length >= max) { hits.set(key, list); return false; }
  list.push(t);
  hits.set(key, list);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((x) => t - x < 3_600_000)) hits.delete(k);
  return true;
}

// ---------- Reads ----------
export async function getBoard(slug: string) {
  const db = load();
  const project = db.projects.find((p) => p.slug === slug);
  if (!project) return null;
  const of = <T extends { project_id: string }>(xs: T[]) => xs.filter((x) => x.project_id === project.id);
  const tasks = of(db.tasks).sort((a, b) => a.position - b.position);
  // Newest note per task. Only notes saved with a task_id count; older notes are never guessed from their text.
  const latestNotes: Record<string, TaskNote> = {};
  for (const n of of(db.notes)) {
    const t = n.task_id ? tasks.find((x) => x.id === n.task_id) : undefined;
    if (!t) continue;
    const prefix = `${t.title}: `;
    latestNotes[t.id] = { text: n.text.startsWith(prefix) ? n.text.slice(prefix.length) : n.text, member_id: n.source_member_id, created_at: n.created_at };
  }
  return {
    project,
    members: of(db.members).map(publicMember),
    tasks,
    decisions: of(db.decisions),
    activity: of(db.activity).slice(-60).reverse(),
    latestNotes,
  };
}

export async function memberBySession(slug: string, session: string | undefined): Promise<Member | null> {
  if (!isToken(session)) return null;
  const db = load();
  const p = db.projects.find((x) => x.slug === slug);
  const m = p && db.members.find((x) => x.project_id === p.id && x.session_token === session);
  if (!m) return null;
  // Seen-at drives the online dot; write it at most once a minute so polling stays cheap.
  if (Date.now() - Date.parse(m.last_seen_at) > 60_000) tx((d) => live(d, m));
  return m;
}

export async function agentContext(agentToken: string): Promise<AgentContext | null> {
  if (!isToken(agentToken)) return null;
  const db = load();
  const me = db.members.find((m) => m.agent_token === agentToken);
  const project = me && db.projects.find((p) => p.id === me.project_id);
  if (!me || !project) return null;
  const of = <T extends { project_id: string }>(xs: T[]) => xs.filter((x) => x.project_id === project.id);
  return {
    project, me,
    members: of(db.members).map(publicMember),
    tasks: of(db.tasks).sort((a, b) => a.position - b.position),
    decisions: of(db.decisions),
    notes: of(db.notes),
  };
}

export async function latestActivityId(slug: string) {
  const db = load();
  const p = db.projects.find((x) => x.slug === slug);
  return p ? db.activity.findLast((a) => a.project_id === p.id)?.id ?? 0 : 0;
}

// ---------- Create and join ----------
export type NewProject = { name: string; context: string; due: string; brief: string; tasks: { title: string; phase: Phase }[] };
export async function createProject(input: NewProject, fixed?: { slug: string; code: string }) {
  const name = clean(input.name, LIMIT.projectName);
  if (!name) return { error: "Give the project a name" };
  const due = input.due && isDate(input.due) ? input.due : null;
  if (input.due && !due) return { error: "Due date must look like 2026-11-30" };
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "project";
  const slug = fixed?.slug ?? `${base}-${randomBytes(2).toString("hex")}`;
  const code = fixed?.code ?? String(randomInt(0, 1_000_000)).padStart(6, "0");
  return tx((db) => {
    if (db.projects.some((p) => p.slug === slug)) return { error: "Try again" };
    const p: Project = {
      id: randomUUID(), slug, name, course_or_context: clean(input.context, LIMIT.context), due_date: due,
      brief: cleanText(input.brief, LIMIT.brief), join_code: code, created_at: now(),
    };
    db.projects.push(p);
    input.tasks.slice(0, LIMIT.tasksOnCreate).forEach((t, i) => db.tasks.push(newTask(p.id, t.title, t.phase, i)));
    log(db, p.id, null, "created", `Project created with ${Math.min(input.tasks.length, LIMIT.tasksOnCreate)} tasks`);
    return { slug, code };
  });
}
const newTask = (project_id: string, title: string, phase: Phase, position: number): Task => ({
  id: randomUUID(), project_id, title: clean(title, LIMIT.title), phase: PHASES.includes(phase) ? phase : "build",
  position, due_date: null, owner_member_id: null, status: "todo", claimed_at: null, done_at: null,
});

export async function deleteProject(slug: string) {
  tx((db) => {
    const p = db.projects.find((x) => x.slug === slug);
    if (!p) return;
    const keep = <T extends { project_id: string }>(xs: T[]) => xs.filter((x) => x.project_id !== p.id);
    Object.assign(db, {
      projects: db.projects.filter((x) => x !== p), members: keep(db.members), tasks: keep(db.tasks),
      decisions: keep(db.decisions), notes: keep(db.notes), activity: keep(db.activity),
    });
  });
}

export async function joinProject(slug: string, input: { name: string; ai_tool: string; code: string }): Promise<Result & { session?: string }> {
  const name = clean(input.name, LIMIT.name);
  const ai_tool = clean(input.ai_tool, LIMIT.aiTool);
  if (!name) return { error: "Enter your name" };
  if (!ai_tool) return { error: "Pick your AI" };
  if (!isCode(input.code)) return { error: "The join code is 6 digits" };
  return tx((db) => {
    const p = db.projects.find((x) => x.slug === slug);
    if (!p) return { error: "This group doesn't exist" };
    if (p.join_code !== input.code) return { error: "That code is not right" };
    const ms = db.members.filter((m) => m.project_id === p.id);
    if (ms.length >= LIMIT.members) return { error: "This group is full" };
    if (ms.some((m) => m.name.toLowerCase() === name.toLowerCase())) return { error: `${name} already joined. Use a different name.` };
    const color = COLORS.find((c) => !ms.some((m) => m.color === c)) ?? COLORS[ms.length % COLORS.length];
    const m: Member = { id: randomUUID(), project_id: p.id, name, ai_tool, color, last_seen_at: now(), agent_token: token(), session_token: token() };
    db.members.push(m);
    log(db, p.id, m.id, "join", `${name} joined with ${ai_tool}`);
    return { ok: "Joined", session: m.session_token };
  });
}

// ---------- Task rules (sync, so they compose inside one write) ----------
function claimIn(db: DB, me: Member, t: Task): Result {
  if (t.owner_member_id === me.id) return { ok: "Already yours" };
  if (t.owner_member_id) return { error: `${nameOf(db, t.owner_member_id)} already has this` };
  t.owner_member_id = me.id;
  t.claimed_at = now();
  log(db, me.project_id, me.id, "claim", `${me.name} claimed ${t.title}`, t.id);
  return { ok: `You claimed ${t.title}` };
}
function statusIn(db: DB, me: Member, t: Task, status: Status): Result {
  if (t.owner_member_id && t.owner_member_id !== me.id) return { error: `${nameOf(db, t.owner_member_id)} owns this task` };
  if (!t.owner_member_id) claimIn(db, me, t);
  if (t.status === status) return { ok: "No change" };
  t.status = status;
  t.done_at = status === "done" ? now() : null;
  const verb = status === "done" ? "finished" : status === "doing" ? "started" : "moved back to todo:";
  log(db, me.project_id, me.id, status === "done" ? "done" : "status", `${me.name} ${verb} ${t.title}`, t.id);
  return { ok: status === "done" ? "Marked done" : status === "doing" ? "Started" : "Moved back to todo" };
}
function noteIn(db: DB, me: Member, text: string, task_id?: string): Result {
  const t = clean(text, LIMIT.storedNote);
  if (!t) return { error: "Note is empty" };
  db.notes.push({ id: randomUUID(), project_id: me.project_id, text: t, source_member_id: me.id, created_at: now(), ...(task_id ? { task_id } : {}) });
  log(db, me.project_id, me.id, "note", `${me.name}: ${t}`, task_id);
  return { ok: "Note added" };
}

// ---------- Member writes ----------
export async function claimTask(me: Member, taskId: string): Promise<Result> {
  return tx((db) => {
    const m = live(db, me), t = findTask(db, me, taskId);
    return !m ? gone : !t ? { error: "Task not found" } : claimIn(db, m, t);
  });
}
export async function setTaskStatus(me: Member, taskId: string, status: Status): Promise<Result> {
  if (!["todo", "doing", "done"].includes(status)) return { error: "Unknown status" };
  return tx((db) => {
    const m = live(db, me), t = findTask(db, me, taskId);
    return !m ? gone : !t ? { error: "Task not found" } : statusIn(db, m, t, status);
  });
}
export async function unclaimTask(me: Member, taskId: string): Promise<Result> {
  return tx((db) => {
    const m = live(db, me), t = findTask(db, me, taskId);
    if (!m) return gone;
    if (!t) return { error: "Task not found" };
    if (t.owner_member_id !== m.id) return { error: "Only the owner can unclaim" };
    Object.assign(t, { owner_member_id: null, status: "todo", claimed_at: null, done_at: null });
    log(db, m.project_id, m.id, "unclaim", `${m.name} unclaimed ${t.title}`, t.id);
    return { ok: "Unclaimed" };
  });
}
// Anyone can hand a task to anyone. It's logged so the group sees it.
export async function reassignTask(me: Member, taskId: string, toId: string): Promise<Result> {
  return tx((db) => {
    const m = live(db, me), t = findTask(db, me, taskId);
    const to = db.members.find((x) => x.id === toId && x.project_id === me.project_id);
    if (!m) return gone;
    if (!t || !to) return { error: "Task or person not found" };
    if (t.owner_member_id === to.id) return { ok: "No change" };
    const was = t.owner_member_id ? ` (was ${nameOf(db, t.owner_member_id)})` : "";
    Object.assign(t, { owner_member_id: to.id, claimed_at: now() });
    if (t.status === "done") Object.assign(t, { status: "doing", done_at: null });
    log(db, m.project_id, m.id, "claim", `${m.name} gave ${t.title} to ${to.id === m.id ? "themself" : to.name}${was}`, t.id);
    return { ok: `Handed to ${to.id === m.id ? "you" : to.name}` };
  });
}
// A task's own deadline. Anyone can set or clear it, like handing a task over, and it's logged.
export async function setTaskDue(me: Member, taskId: string, due: string | null): Promise<Result> {
  if (due !== null && !isDate(due)) return { error: "Deadline must look like 2026-11-30" };
  return tx((db) => {
    const m = live(db, me), t = findTask(db, me, taskId);
    if (!m) return gone;
    if (!t) return { error: "Task not found" };
    if (t.due_date === due) return { ok: "No change" };
    t.due_date = due;
    log(db, m.project_id, m.id, "task", due ? `${m.name} set ${t.title} due ${due}` : `${m.name} cleared the deadline on ${t.title}`, t.id);
    return { ok: due ? "Deadline set" : "Deadline cleared" };
  });
}
export async function addTask(me: Member, title: string, phase: Phase): Promise<Result> {
  const t = clean(title, LIMIT.title);
  if (!t) return { error: "Task needs a title" };
  return tx((db) => {
    const m = live(db, me);
    if (!m) return gone;
    const ts = db.tasks.filter((x) => x.project_id === m.project_id);
    if (ts.length >= LIMIT.tasksPerProject) return { error: "This project has the most tasks allowed" };
    db.tasks.push(newTask(m.project_id, t, phase, Math.max(-1, ...ts.map((x) => x.position)) + 1));
    log(db, m.project_id, m.id, "task", `${m.name} added ${t}`);
    return { ok: "Task added" };
  });
}
export async function addNote(me: Member, text: string): Promise<Result> {
  return tx((db) => { const m = live(db, me); return m ? noteIn(db, m, clean(text, LIMIT.note)) : gone; });
}

// Update blocks from paste back, agent POST and MCP. Same rules as the buttons.
export type BlockResult = { task: string; ok: boolean; message: string };
export async function applyUpdates(me: Member, blocks: UpdateBlock[]): Promise<BlockResult[]> {
  return tx((db) => {
    const m = live(db, me);
    const tasks = db.tasks.filter((t) => t.project_id === me.project_id);
    return blocks.slice(0, LIMIT.blocks).map((b): BlockResult => {
      if (!m) return { task: b.task, ok: false, message: gone.error! };
      if (b.error) return { task: b.task || "(no task)", ok: false, message: b.error };
      const t = matchTask(tasks, b.task);
      if (!t) return { task: b.task, ok: false, message: "No task with that title" };
      if (t.owner_member_id && t.owner_member_id !== m.id) return { task: t.title, ok: false, message: `${nameOf(db, t.owner_member_id)} owns this task` };
      const done: string[] = [];
      if (b.status) { statusIn(db, m, t, b.status); done.push(b.status); }
      if (b.note) { noteIn(db, m, `${t.title}: ${b.note}`, t.id); done.push("note added"); }
      return { task: t.title, ok: true, message: done.join(", ") };
    });
  });
}

// ---------- Decisions ----------
export async function proposeDecision(me: Member, text: string): Promise<Result> {
  const t = clean(text, LIMIT.decision);
  if (!t) return { error: "Write the idea first" };
  return tx((db) => {
    const m = live(db, me);
    if (!m) return gone;
    db.decisions.push({ id: randomUUID(), project_id: m.project_id, text: t, created_by: m.id, approved_by: null, created_at: now() });
    log(db, m.project_id, m.id, "decision", `${m.name} suggested: ${t}`);
    return { ok: "Suggested to the team" };
  });
}
export async function approveDecision(me: Member, id: string): Promise<Result> {
  return tx((db) => {
    const m = live(db, me), d = db.decisions.find((x) => x.id === id && x.project_id === me.project_id);
    if (!m) return gone;
    if (!d) return { error: "Not found" };
    if (d.approved_by) return { ok: "Already agreed" };
    if (d.created_by === m.id) return { error: "A teammate needs to agree to your idea" };
    d.approved_by = m.id;
    log(db, m.project_id, m.id, "decision", `${m.name} agreed: ${d.text}`);
    return { ok: "Agreed. Every AI on the team now follows this." };
  });
}

