// Storage and every write rule. Server only. The UI (server actions), agent POST and MCP all call these.
// PostgreSQL serializes writes per project. Local development uses a synchronous JSON write.
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { empty, loadActivityId, loadFileBytes, loadProject, loadSession, projectTransaction, recordRateHit, type DB, type Selector, type StoredFile } from "./postgres";
import {
  COLORS, FILE_ACCEPT, FILE_LIMIT, LIMIT, PHASES, clean, cleanText, isCode, isDate, isToken, matchTask, publicMember,
  type Activity, type AgentContext, type Decision, type Member, type Note, type Phase,
  type Project, type ProjectFile, type Result, type Status, type Task, type UpdateBlock,
} from "./core";

const file = () => resolve(process.env.IGLOO_DATA_FILE ?? "data/db.json");

function loadFile(): DB {
  try { return { ...empty(), ...JSON.parse(readFileSync(file(), "utf8")) }; } catch { return empty(); }
}
const load = (by: Selector) => process.env.DATABASE_URL ? loadProject(by) : loadFile();

function tx<T>(by: Selector, fn: (db: DB) => T): T | Promise<T> {
  if (process.env.DATABASE_URL) return projectTransaction(by, fn);
  const db = loadFile();
  const out = fn(db);
  const f = file();
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f + ".tmp", JSON.stringify(db));
  renameSync(f + ".tmp", f);
  return out;
}

const now = () => new Date().toISOString();
const token = () => randomBytes(32).toString("hex");
function log(db: DB, project_id: string, member_id: string | null, kind: string, message: string) {
  db.activity.push({ id: ++db.seq, project_id, member_id, kind, message, created_at: now() });
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
const publicFile = ({ data: _data, ...metadata }: StoredFile): ProjectFile => metadata;
const hashToken = (value: string) => createHash("sha256").update(value).digest("hex");

// ---------- Rate limits ----------
const hits = new Map<string, number[]>();
export async function rateLimit(key: string, max: number, windowMs: number) {
  if (process.env.DATABASE_URL) {
    return recordRateHit(hashToken(key), max, windowMs);
  }
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
  const db = await load({ slug });
  const project = db.projects.find((p) => p.slug === slug);
  if (!project) return null;
  const of = <T extends { project_id: string }>(xs: T[]) => xs.filter((x) => x.project_id === project.id);
  return {
    project,
    members: of(db.members).map(publicMember),
    tasks: of(db.tasks).sort((a, b) => a.position - b.position),
    decisions: of(db.decisions),
    files: of(db.project_files).map(publicFile),
    activity: of(db.activity).slice(-60).reverse(),
  };
}

export async function memberBySession(slug: string, session: string | undefined): Promise<Member | null> {
  if (!isToken(session)) return null;
  let m: Member | null | undefined;
  if (process.env.DATABASE_URL) {
    m = await loadSession(slug, session);
  } else {
    const db = loadFile();
    const p = db.projects.find((x) => x.slug === slug);
    m = p && db.members.find((x) => x.project_id === p.id && x.session_token === session);
  }
  if (!m) return null;
  // Seen-at drives the online dot; write it at most once a minute so polling stays cheap.
  if (Date.now() - Date.parse(m.last_seen_at) > 60_000) {
    await tx({ projectId: m.project_id }, (d) => {
      const current = d.members.find((x) => x.id === m.id);
      if (current && Date.now() - Date.parse(current.last_seen_at) > 60_000) live(d, m);
    });
  }
  return m;
}

export async function agentContext(agentToken: string): Promise<AgentContext | null> {
  if (!isToken(agentToken)) return null;
  const db = await load({ agentToken });
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
    files: of(db.project_files).map(publicFile),
  };
}

export async function latestActivityId(slug: string) {
  if (process.env.DATABASE_URL) return loadActivityId(slug);
  const db = loadFile();
  const p = db.projects.find((x) => x.slug === slug);
  return p ? db.activity.findLast((a) => a.project_id === p.id)?.id ?? 0 : 0;
}

export async function createDeviceCode(me: Member): Promise<Result & { code?: string }> {
  const code = token();
  return tx({ projectId: me.project_id }, (db) => {
    const member = live(db, me);
    if (!member) return gone;
    member.device_code_hash = hashToken(code);
    member.device_expires_at = new Date(Date.now() + 10 * 60_000).toISOString();
    return { code };
  });
}

export async function redeemDeviceCode(slug: string, code: string) {
  if (!isToken(code)) return null;
  const hash = hashToken(code);
  return tx({ slug }, (db) => {
    const project = db.projects.find((entry) => entry.slug === slug);
    const member = project && db.members.find((entry) =>
      entry.project_id === project.id && entry.device_code_hash === hash &&
      !!entry.device_expires_at && Date.parse(entry.device_expires_at) > Date.now());
    if (!member) return null;
    member.device_code_hash = null;
    member.device_expires_at = null;
    member.last_seen_at = now();
    return member.session_token;
  });
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
  return tx({ slug }, (db) => {
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
  await tx({ slug }, (db) => {
    const p = db.projects.find((x) => x.slug === slug);
    if (!p) return;
    const keep = <T extends { project_id: string }>(xs: T[]) => xs.filter((x) => x.project_id !== p.id);
    Object.assign(db, {
      projects: db.projects.filter((x) => x !== p), members: keep(db.members), tasks: keep(db.tasks),
      decisions: keep(db.decisions), notes: keep(db.notes), activity: keep(db.activity),
      project_files: keep(db.project_files),
    });
  });
}

export async function shareFile(me: Member, file: File, taskId: string): Promise<Result> {
  if (!file.size || file.size > FILE_LIMIT) return { error: "Choose a file between 1 byte and 2 MB" };
  const name = clean(file.name.replace(/[\\/]/g, "_"), 160);
  const extension = extname(name).toLowerCase();
  if (!FILE_ACCEPT.split(",").includes(extension)) return { error: "This file type is not supported" };
  const kind = extension === ".pdf" ? "pdf" : extension === ".pptx" ? "slides" : extension === ".docx" ? "document" : "text";
  const bytes = Buffer.from(await file.arrayBuffer());
  if (kind === "pdf" && !bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) return { error: "Choose a valid PDF" };
  if ((kind === "slides" || kind === "document") && (bytes.length < 4 || bytes.readUInt32LE(0) !== 0x04034b50)) {
    return { error: "Choose a valid PowerPoint or Word file" };
  }
  if (kind === "text") {
    try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { return { error: "Source files must use UTF-8 text" }; }
    if (bytes.includes(0)) return { error: "Source files must contain text" };
  }
  return tx({ projectId: me.project_id }, (db) => {
    const member = live(db, me);
    if (!member) return gone;
    if (taskId && !findTask(db, me, taskId)) return { error: "Task not found" };
    const files = db.project_files.filter((entry) => entry.project_id === me.project_id);
    if (files.length >= 24 || files.reduce((sum, entry) => sum + entry.size, bytes.length) > 12 * 1024 * 1024) {
      return { error: "This project has reached its shared file limit" };
    }
    db.project_files.push({
      id: randomUUID(), project_id: me.project_id, task_id: taskId || null, member_id: member.id,
      name, kind, size: bytes.length, created_at: now(), data: bytes.toString("base64"),
    });
    log(db, me.project_id, member.id, "file", `${member.name} shared ${name}`);
    return { ok: "File shared" };
  });
}

// Any member can remove a shared file. It's logged so the group sees who did it.
export async function deleteFile(me: Member, id: string): Promise<Result> {
  return tx({ projectId: me.project_id }, (db) => {
    const member = live(db, me);
    if (!member) return gone;
    const file = db.project_files.find((entry) => entry.id === id && entry.project_id === me.project_id);
    if (!file) return { error: "File not found" };
    db.project_files = db.project_files.filter((entry) => entry !== file);
    log(db, me.project_id, member.id, "file", `${member.name} deleted ${file.name}`);
    return { ok: `Deleted ${file.name}` };
  });
}

export async function sharedFile(projectId: string, id: string) {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id)) return null;
  const file = process.env.DATABASE_URL ? await loadFileBytes(projectId, id) :
    loadFile().project_files.find((entry) => entry.project_id === projectId && entry.id === id);
  return file?.data ? { ...publicFile(file), bytes: Buffer.from(file.data, "base64") } : null;
}

export async function joinProject(slug: string, input: { name: string; ai_tool: string; code: string }): Promise<Result & { session?: string }> {
  const name = clean(input.name, LIMIT.name);
  const ai_tool = clean(input.ai_tool, LIMIT.aiTool);
  if (!name) return { error: "Enter your name" };
  if (!ai_tool) return { error: "Pick your AI" };
  if (!isCode(input.code)) return { error: "The join code is 6 digits" };
  return tx({ slug }, (db) => {
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
  log(db, me.project_id, me.id, "claim", `${me.name} claimed ${t.title}`);
  return { ok: `You claimed ${t.title}` };
}
function statusIn(db: DB, me: Member, t: Task, status: Status): Result {
  if (t.owner_member_id && t.owner_member_id !== me.id) return { error: `${nameOf(db, t.owner_member_id)} owns this task` };
  if (!t.owner_member_id) claimIn(db, me, t);
  if (t.status === status) return { ok: "No change" };
  t.status = status;
  t.done_at = status === "done" ? now() : null;
  const verb = status === "done" ? "finished" : status === "doing" ? "started" : "moved back to todo:";
  log(db, me.project_id, me.id, status === "done" ? "done" : "status", `${me.name} ${verb} ${t.title}`);
  return { ok: status === "done" ? "Marked done" : status === "doing" ? "Started" : "Moved back to todo" };
}
function noteIn(db: DB, me: Member, text: string): Result {
  const t = clean(text, LIMIT.storedNote);
  if (!t) return { error: "Note is empty" };
  db.notes.push({ id: randomUUID(), project_id: me.project_id, text: t, source_member_id: me.id, created_at: now() });
  log(db, me.project_id, me.id, "note", `${me.name}: ${t}`);
  return { ok: "Note added" };
}

// ---------- Member writes ----------
export async function claimTask(me: Member, taskId: string): Promise<Result> {
  return tx({ projectId: me.project_id }, (db) => {
    const m = live(db, me), t = findTask(db, me, taskId);
    return !m ? gone : !t ? { error: "Task not found" } : claimIn(db, m, t);
  });
}
export async function setTaskStatus(me: Member, taskId: string, status: Status): Promise<Result> {
  if (!["todo", "doing", "done"].includes(status)) return { error: "Unknown status" };
  return tx({ projectId: me.project_id }, (db) => {
    const m = live(db, me), t = findTask(db, me, taskId);
    return !m ? gone : !t ? { error: "Task not found" } : statusIn(db, m, t, status);
  });
}
export async function unclaimTask(me: Member, taskId: string): Promise<Result> {
  return tx({ projectId: me.project_id }, (db) => {
    const m = live(db, me), t = findTask(db, me, taskId);
    if (!m) return gone;
    if (!t) return { error: "Task not found" };
    if (t.owner_member_id !== m.id) return { error: "Only the owner can unclaim" };
    Object.assign(t, { owner_member_id: null, status: "todo", claimed_at: null, done_at: null });
    log(db, m.project_id, m.id, "unclaim", `${m.name} unclaimed ${t.title}`);
    return { ok: "Unclaimed" };
  });
}
// Anyone can hand a task to anyone. It's logged so the group sees it.
export async function reassignTask(me: Member, taskId: string, toId: string): Promise<Result> {
  return tx({ projectId: me.project_id }, (db) => {
    const m = live(db, me), t = findTask(db, me, taskId);
    const to = db.members.find((x) => x.id === toId && x.project_id === me.project_id);
    if (!m) return gone;
    if (!t || !to) return { error: "Task or person not found" };
    if (t.owner_member_id === to.id) return { ok: "No change" };
    const was = t.owner_member_id ? ` (was ${nameOf(db, t.owner_member_id)})` : "";
    Object.assign(t, { owner_member_id: to.id, claimed_at: now() });
    if (t.status === "done") Object.assign(t, { status: "doing", done_at: null });
    log(db, m.project_id, m.id, "claim", `${m.name} gave ${t.title} to ${to.id === m.id ? "themself" : to.name}${was}`);
    return { ok: `Handed to ${to.id === m.id ? "you" : to.name}` };
  });
}
export async function addTask(me: Member, title: string, phase: Phase): Promise<Result> {
  const t = clean(title, LIMIT.title);
  if (!t) return { error: "Task needs a title" };
  return tx({ projectId: me.project_id }, (db) => {
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
  return tx({ projectId: me.project_id }, (db) => { const m = live(db, me); return m ? noteIn(db, m, clean(text, LIMIT.note)) : gone; });
}

// Update blocks from paste back, agent POST and MCP. Same rules as the buttons.
export type BlockResult = { task: string; ok: boolean; message: string };
export async function applyUpdates(me: Member, blocks: UpdateBlock[]): Promise<BlockResult[]> {
  return tx({ projectId: me.project_id }, (db) => {
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
      if (b.note) { noteIn(db, m, `${t.title}: ${b.note}`); done.push("note added"); }
      return { task: t.title, ok: true, message: done.join(", ") };
    });
  });
}

// ---------- Decisions ----------
export async function proposeDecision(me: Member, text: string): Promise<Result> {
  const t = clean(text, LIMIT.decision);
  if (!t) return { error: "Write the idea first" };
  return tx({ projectId: me.project_id }, (db) => {
    const m = live(db, me);
    if (!m) return gone;
    db.decisions.push({ id: randomUUID(), project_id: m.project_id, text: t, created_by: m.id, approved_by: null, created_at: now() });
    log(db, m.project_id, m.id, "decision", `${m.name} suggested: ${t}`);
    return { ok: "Suggested to the team" };
  });
}
export async function approveDecision(me: Member, id: string): Promise<Result> {
  return tx({ projectId: me.project_id }, (db) => {
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

