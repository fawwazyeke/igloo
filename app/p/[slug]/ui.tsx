"use client";
// The whole group page, laid out like docs/group-page-sample.html.
import { useActionState, useCallback, useEffect, useMemo, useOptimistic, useRef, useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import * as A from "@/app/actions";
import { Dropdown } from "./dropdown";
import { FileThumbnail } from "./file-thumbnail";
import {
  AI_TOOLS, FILE_ACCEPT, FILE_LABEL, FILE_LIMIT, buildDigest, dueLabel, fileUrl, isToken, matchTask, parseUpdates, timeAgo,
  type Activity, type Decision, type MemberPublic, type ProjectFile, type Result, type Status, type Task,
} from "@/lib/core";

const STATUS_LABEL: Record<Status, string> = { todo: "To do", doing: "In progress", done: "Done" };
const Chip = ({ status }: { status: Status }) => <span className={`chip ${status}`}>{STATUS_LABEL[status]}</span>;
const Dot = ({ color, title }: { color: string; title?: string }) => <span className="dot" style={{ background: color }} title={title} />;

// The clipboard API is missing on plain http (a Wi-Fi address), so fall back to execCommand.
function copy(text: string) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  const ta = document.createElement("textarea");
  ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove();
  return Promise.resolve();
}

// ======================= Join =======================
export function JoinForm({ slug, name, context, code }: { slug: string; name: string; context: string; code?: string }) {
  const [state, action, pending] = useActionState(A.joinProject, undefined);
  const [tool, setTool] = useState("Claude");
  const [alreadyIn, setAlreadyIn] = useState(false);
  if (alreadyIn) return <DeviceForm slug={slug} name={name} back={() => setAlreadyIn(false)} />;
  return (
    <main className="page dots">
      <div className="page-inner narrow">
        <div className="ctx">{context || "Igloo"}</div>
        <h1>Join {name}</h1>
        <p className="lead">Keep using your own AI. This is where your team and your AIs meet.</p>
        {code && <div className="hint">🎉 Your project is ready. Join it yourself first, then invite your team.</div>}
        <form action={action} className="card form">
          <input type="hidden" name="slug" value={slug} />
          <div>
            <label className="label" htmlFor="name">Your name</label>
            <input id="name" name="name" required maxLength={40} autoFocus className="input" placeholder="Aisha" />
          </div>
          <div>
            <span className="label">Your AI</span>
            <div className="pills">
              {AI_TOOLS.map((t) => <button key={t} type="button" className={tool === t ? "on" : ""} aria-pressed={tool === t} onClick={() => setTool(t)}>{t}</button>)}
            </div>
            {tool === "Other"
              ? <input name="ai_tool" required maxLength={40} className="input" style={{ marginTop: 8 }} placeholder="Which AI?" aria-label="Which AI" />
              : <input type="hidden" name="ai_tool" value={tool} />}
          </div>
          <div>
            <label className="label" htmlFor="code">Join code</label>
            <input id="code" name="code" required inputMode="numeric" pattern="\d{6}" maxLength={6} defaultValue={code} className="input code-input mono" placeholder="000000" />
          </div>
          {state?.error && <p className="err">{state.error}</p>}
          <button className="btn big" disabled={pending}>{pending ? "Joining…" : "Join project"}</button>
        </form>
        <button className="ghost big rejoin-button" type="button" onClick={() => setAlreadyIn(true)}>I’m already in</button>
      </div>
    </main>
  );
}

export function DeviceForm({ slug, name, back }: { slug: string; name: string; back?: () => void }) {
  const [state, action, pending] = useActionState(A.rejoinDevice, undefined);
  const [code, setCode] = useState<string | null>(null);
  const [pastedLink, setPastedLink] = useState("");
  useEffect(() => {
    const value = new URLSearchParams(location.hash.slice(1)).get("device");
    if (isToken(value)) {
      setCode(value);
      history.replaceState(history.state, "", location.pathname + location.search);
    }
  }, []);
  let pastedCode: string | null = null;
  if (back && pastedLink.trim()) {
    try {
      const link = new URL(pastedLink.trim());
      const value = new URLSearchParams(link.hash.slice(1)).get("device");
      if (link.pathname === `/p/${slug}` && link.searchParams.get("rejoin") === "1" && isToken(value)) pastedCode = value;
    } catch { /* An incomplete or invalid paste cannot be submitted. */ }
  }
  const device = back ? pastedCode : code;
  return <main className="page dots">
    <div className="page-inner narrow">
      <div className="ctx">Igloo · Existing membership</div>
      <h1>Rejoin {name}</h1>
      <p className="lead">Use the same name, tasks, and private agent link on this browser.</p>
      <form className="card form" action={action}>
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="device" value={device ?? ""} />
        {back && <label className="label">Private rejoin link
          <input className="input" type="text" value={pastedLink} onChange={(event) => setPastedLink(event.target.value)} maxLength={512} autoComplete="off" spellCheck={false} />
          <span className="small">On the browser where you’re already in this project, click Copy rejoin link.</span>
        </label>}
        {state?.error && <p className="err" role="alert">{state.error}</p>}
        <button className="btn big" disabled={pending || !device}>{pending ? "Rejoining…" : "Continue with my membership"}</button>
        {!back && !code && <p className="small">If you don’t have a code here, reopen the original rejoin link.</p>}
      </form>
      {back && <button className="ghost big rejoin-button" type="button" onClick={back}>Back to join</button>}
    </div>
  </main>;
}

// ======================= App =======================
export type AppData = {
  slug: string;
  project: { name: string; course_or_context: string; due_date: string | null; brief: string; join_code: string };
  me: MemberPublic & { agent_token: string };
  members: MemberPublic[];
  tasks: Task[];
  decisions: Decision[];
  activity: Activity[];
  files: ProjectFile[];
};
type Tab = "tasks" | "ai" | "activity" | "decisions" | "files";
type Toast = { id: number; text: string; tone: "ok" | "bad" | "info" };
type Actions = ReturnType<typeof useActions>;
type Ctx = { d: AppData; byId: Map<string, MemberPublic>; a: Actions; openFile: (id: string) => void };

type TaskPatch = { id: string; changes: Partial<Task> };
function useActions(d: AppData, toast: (t: string, tone?: Toast["tone"]) => void, patch: (p: TaskPatch) => void) {
  const [, start] = useTransition();
  // The optimistic change shows at once. It stays until the server answers and the board refreshes,
  // and React drops it on its own if the server refused (for example, a teammate claimed first).
  const run = (call: () => Promise<Result>, optimistic?: TaskPatch) => start(async () => {
    if (optimistic) patch(optimistic);
    const r = await call();
    if (r.error) toast(r.error, "bad"); else if (r.ok) toast(r.ok, "ok");
  });
  const now = () => new Date().toISOString();
  const groupUrl = () => `${location.origin}/p/${d.slug}`;
  return {
    claim: (t: Task) => run(() => A.claim(d.slug, t.id),
      t.owner_member_id ? undefined : { id: t.id, changes: { owner_member_id: d.me.id, claimed_at: now() } }),
    status: (t: Task, s: Status) => run(() => A.setStatus(d.slug, t.id, s),
      !t.owner_member_id || t.owner_member_id === d.me.id
        ? { id: t.id, changes: { status: s, done_at: s === "done" ? now() : null, owner_member_id: d.me.id, claimed_at: t.claimed_at ?? now() } }
        : undefined),
    unclaim: (t: Task) => run(() => A.unclaim(d.slug, t.id),
      t.owner_member_id === d.me.id ? { id: t.id, changes: { owner_member_id: null, status: "todo", claimed_at: null, done_at: null } } : undefined),
    reassign: (t: Task, m: string) => run(() => A.reassign(d.slug, t.id, m),
      { id: t.id, changes: { owner_member_id: m, claimed_at: now(), ...(t.status === "done" ? { status: "doing" as const, done_at: null } : {}) } }),
    addTask: (title: string) => run(() => A.addTask(d.slug, title)),
    propose: (text: string) => run(() => A.proposeDecision(d.slug, text)),
    approve: (id: string) => run(() => A.approveDecision(d.slug, id)),
    copyDigest: () => copy(buildDigest(d.project, d.members, d.tasks, groupUrl())).then(() => toast("Update copied. Paste it in your group chat.", "ok")),
    copyAgent: () => copy(`${location.origin}/a/${d.me.agent_token}`).then(() => toast("Link copied. Paste it into your AI, and keep it private.", "ok")),
    copyInvite: () => copy(`Join ${d.project.name} on Igloo\n${groupUrl()}\nCode: ${d.project.join_code}`).then(() => toast("Invite copied", "ok")),
  };
}

export function App(props: AppData) {
  // Task buttons update this copy right away, before the server confirms.
  const [tasks, patchTasks] = useOptimistic(props.tasks, (ts: Task[], p: TaskPatch) =>
    ts.map((t) => (t.id === p.id ? { ...t, ...p.changes } : t)));
  const d = useMemo(() => ({ ...props, tasks }), [props, tasks]);
  const router = useRouter();
  const [view, setView] = useState<"board" | "list">("board");
  const [tab, setTab] = useState<Tab>("tasks");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [copyingDevice, setCopyingDevice] = useState(false);
  const [deviceLink, setDeviceLink] = useState<string | null>(null);
  const [palette, setPalette] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const byId = useMemo(() => new Map(d.members.map((m) => [m.id, m])), [d.members]);

  const toast = useCallback((text: string, tone: Toast["tone"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);
  const a = useActions(d, toast, patchTasks);

  // Live: every 3 seconds ask for the newest activity id; refresh when it changed, toast teammates' events.
  const latest = d.activity[0]?.id ?? 0;
  const seen = useRef(new Set(d.activity.map((x) => x.id)));
  useEffect(() => {
    const fresh = d.activity.filter((x) => !seen.current.has(x.id));
    fresh.forEach((x) => seen.current.add(x.id));
    fresh.filter((x) => x.member_id !== d.me.id).slice(0, 3).reverse().forEach((x) => toast(x.message));
  }, [d.activity, d.me.id, toast]);
  useEffect(() => {
    const t = setInterval(async () => {
      if (document.hidden) return;
      const id = await A.pulse(d.slug).catch(() => null);
      if (id !== null && id !== latest) router.refresh();
    }, 3000);
    return () => clearInterval(t);
  }, [d.slug, latest, router]);

  // N, or Cmd/Ctrl K, opens quick actions.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /input|textarea|select/i.test((e.target as HTMLElement)?.tagName ?? "");
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key.toLowerCase() === "n" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey)) {
        e.preventDefault(); setPalette((p) => !p);
      } else if (e.key === "Escape") setPalette(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const openFile = (id: string) => { setSelectedFile(id); setTab("files"); };
  const openFiles = () => { setSelectedFile(null); setTab("files"); };
  const copyRejoin = async () => {
    setCopyingDevice(true);
    try {
      const result = await A.copyDeviceLink(d.slug);
      if (!("path" in result) || !result.path) { toast(result.error ?? "Could not create a rejoin link", "bad"); return; }
      const link = new URL(result.path, location.origin).href;
      try {
        await copy(link);
        toast("Rejoin link copied. It works once for 10 minutes.", "ok");
      } catch { setDeviceLink(link); }
    } catch {
      toast("Could not create a rejoin link", "bad");
    } finally { setCopyingDevice(false); }
  };
  const ctx = { d, byId, a, openFile };
  const waiting = d.decisions.some((x) => !x.approved_by);

  return (
    <div className="app">
      <header>
        <div>
          <div className="ctx">{[d.project.course_or_context, d.project.due_date && dueLabel(d.project.due_date)].filter(Boolean).join(" · ") || "Igloo"}</div>
          <div className="title">{d.project.name}</div>
        </div>
        <div className="hright">
          <div className="seg" role="group" aria-label="View">
            {(["board", "list"] as const).map((v) => <button key={v} className={view === v ? "on" : ""} aria-pressed={view === v} onClick={() => setView(v)}>{v === "board" ? "Board" : "List"}</button>)}
          </div>
          <button className="ghost" onClick={a.copyInvite}>Invite</button>
          <button className="ghost" onClick={openFiles}>Add file</button>
          <button className="btn" onClick={a.copyDigest}>Copy update for group chat</button>
          <button className="ghost" style={{ color: "var(--muted)" }} onClick={() => setPalette(true)} title="Quick actions (N or ⌘K)">Quick actions</button>
          <div className="me">
            <Dot color={d.me.color} />{d.me.name}
            <button className="linkbtn" onClick={copyRejoin} disabled={copyingDevice}>Copy rejoin link</button>
            <form action={A.leaveDevice}>
              <input type="hidden" name="slug" value={d.slug} />
              <button className="linkbtn" title="Not you? Switch person on this device">Switch</button>
            </form>
          </div>
        </div>
      </header>
      {deviceLink && <div className="hint">
        <label className="label">Private rejoin link (one use, 10 minutes)
          <input className="input" readOnly value={deviceLink} onFocus={(event) => event.currentTarget.select()} />
        </label>
        <button className="linkbtn" onClick={() => setDeviceLink(null)}>Dismiss</button>
      </div>}

      <div className="body">
        <main>
          {view === "board" ? <Board d={d} openFile={openFile} /> : (
            <div className="list dots">
              <div className="stack">
                <div className="card"><TaskList {...ctx} /></div>
              </div>
            </div>
          )}
        </main>
        <aside>
          <nav role="tablist">
            {([["tasks", "Tasks"], ["files", "Files"], ["ai", "Your AI"], ["activity", "What's new"], ["decisions", "Decisions"]] as const).map(([k, label]) => (
              <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
                {label}{k === "decisions" && waiting && <span className="badge" aria-label="waiting for a yes">•</span>}
              </button>
            ))}
          </nav>
          <div className="pane">
            {tab === "tasks" && <TaskList {...ctx} />}
            {tab === "files" && <FilesPanel d={d} byId={byId} selected={selectedFile} openFile={openFile} back={openFiles} />}
            {tab === "ai" && <AiPanel d={d} a={a} toast={toast} />}
            {tab === "activity" && <Feed {...ctx} />}
            {tab === "decisions" && <Decisions {...ctx} />}
          </div>
        </aside>
      </div>

      {palette && <Palette {...ctx} close={() => setPalette(false)} setView={setView} setTab={setTab} />}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.tone}`}>{t.tone === "ok" ? "✓ " : ""}{t.text}</div>)}
      </div>
    </div>
  );
}

// ---------- Board ----------
// A fixed stage, scaled to fit. With 4 members it is the sample's layout (1100 x 790); more members widen the ring.
function Board({ d, openFile }: { d: AppData; openFile: (id: string) => void }) {
  const n = d.members.length, grow = Math.max(1, n / 6);
  const rx = 425 * grow, ry = 320 * grow, W = 2 * rx + 250, H = 2 * ry + 150, cx = W / 2, cy = H / 2;
  const visibleFiles = d.files.slice(-3).reverse();
  const stageHeight = H + (visibleFiles.length ? 210 : 0);
  const nodes = d.members.map((m, i) => {
    const ang = (i / Math.max(n, 1)) * Math.PI * 2 - Math.PI / 2;
    const mine = d.tasks.filter((t) => t.owner_member_id === m.id);
    const task = mine.find((t) => t.status === "doing") ?? mine.find((t) => t.status === "todo") ?? mine.findLast((t) => t.status === "done");
    return { m, x: cx + Math.cos(ang) * rx, y: cy + Math.sin(ang) * ry, task, active: mine.some((t) => t.status === "doing") };
  });
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setScale(Math.min(el.clientWidth / (W + 40), el.clientHeight / (stageHeight + 40), 1));
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    fit();
    return () => ro.disconnect();
  }, [W, stageHeight]);
  const locked = d.decisions.filter((x) => x.approved_by).length;

  return (
    <div ref={box} className="board dots">
      <div className="stage" style={{ width: W, height: stageHeight, transform: `scale(${scale}) translate(${-cx}px, ${-stageHeight / 2}px)`, visibility: scale ? "visible" : "hidden" }}>
        <svg width={W} height={stageHeight} aria-hidden>
          {nodes.map((p) => <line key={p.m.id} x1={cx} y1={cy} x2={p.x} y2={p.y} strokeWidth={1.5} stroke={p.active ? p.m.color : "#ebe4d8"} className={p.active ? "flow" : undefined} />)}
          {visibleFiles.map((f, i) => <line key={f.id} x1={cx} y1={cy} x2={cx + (i - (visibleFiles.length - 1) / 2) * 285} y2={H + 103} strokeWidth={1.5} stroke="#eab694" />)}
        </svg>
        <div className="node brain" style={{ left: cx, top: cy }}>
          <div className="eyebrow">Team project</div>
          <div className="title">{d.project.name}</div>
          {d.project.brief && <p className="brief">{d.project.brief}</p>}
          <div className="split"><span>🤝 {locked} agreed decision{locked === 1 ? "" : "s"}</span><span>📅 {dueLabel(d.project.due_date)}</span></div>
        </div>
        {nodes.map(({ m, x, y, task }) => {
          const online = Date.now() - Date.parse(m.last_seen_at) < 5 * 60_000;
          return (
            <div key={m.id} className={`node member ${m.id === d.me.id ? "mine" : ""}`} style={{ left: x, top: y }}>
              <div className="mhead">
                <span className="avatar" style={{ background: m.color }}>{m.name[0]?.toUpperCase()}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500 }}>{m.name}{m.id === d.me.id && <span className="you">you</span>}</div>
                  <div className="small">uses {m.ai_tool}</div>
                </div>
                <Dot color={online ? "var(--ok)" : "var(--border)"} title={online ? "Active now" : `Seen ${timeAgo(m.last_seen_at)}`} />
              </div>
              <div className="now">{task ? <><span>{task.title}</span><Chip status={task.status} /></> : <span className="small">Not working on anything yet</span>}</div>
            </div>
          );
        })}
        {visibleFiles.map((f, i) => (
          <FileCard key={f.id} file={f} slug={d.slug} className="node file-node"
            style={{ left: cx + (i - (visibleFiles.length - 1) / 2) * 285, top: H + 103 }}
            subtitle={d.tasks.find((task) => task.id === f.task_id)?.title ?? "Project file"} openFile={openFile} />
        ))}
      </div>
    </div>
  );
}

function FileCard({ file, slug, className, style, subtitle, openFile }: {
  file: ProjectFile; slug: string; className: string; style?: CSSProperties; subtitle: string; openFile: (id: string) => void;
}) {
  return <div className={`file-card ${className}`} style={style}>
    <FileThumbnail key={file.id} file={file} slug={slug} />
    <button className="file-open" type="button" onClick={() => openFile(file.id)}>
      <strong>{file.name}</strong><span className="small">{FILE_LABEL[file.kind]} · {subtitle}</span>
    </button>
  </div>;
}

function FilesPanel({ d, byId, selected, openFile, back }: {
  d: AppData; byId: Map<string, MemberPublic>; selected: string | null; openFile: (id: string) => void; back: () => void;
}) {
  const [state, action, pending] = useActionState(A.shareFile, {});
  const [linkedTask, setLinkedTask] = useState("");
  const file = d.files.find((entry) => entry.id === selected);
  const titleOf = (entry: ProjectFile) => d.tasks.find((task) => task.id === entry.task_id)?.title ?? "Project file";
  if (file) return (
    <section className="sec">
      <button className="linkbtn" onClick={back}>← All files</button>
      <div className="file-detail">
        <div className="eyebrow">{FILE_LABEL[file.kind]} · {titleOf(file)}</div>
        <h2 className="title">{file.name}</h2>
        <div className="small">Shared by {byId.get(file.member_id)?.name ?? "A teammate"} · {Math.max(1, Math.round(file.size / 1024))} KB</div>
        <FileThumbnail key={file.id} file={file} slug={d.slug} />
        <div className="wrap-row file-actions">
          <a className="btn" href={fileUrl(file.id, d.slug)}>Download</a>
          {file.kind === "pdf" && <a className="ghost" href={fileUrl(file.id, d.slug) + "&preview=1"} target="_blank" rel="noreferrer">Open PDF</a>}
        </div>
        {file.kind === "text" && <FileText key={`text-${file.id}`} url={fileUrl(file.id, d.slug) + "&preview=1"} />}
        {(file.kind === "slides" || file.kind === "document") && <p className="small">Download to open it, or share a PDF copy for browser preview.</p>}
      </div>
    </section>
  );
  return (
    <section className="sec">
      <div className="sec-t">Shared files</div>
      {d.files.length === 0 && <p className="small">Share a prototype, source file, deck or reference with your team.</p>}
      <form className="file-form" action={action}>
        <input type="hidden" name="slug" value={d.slug} />
        <label className="label">Add a file<input className="input" type="file" name="file" accept={FILE_ACCEPT} required onChange={(event) => {
          const input = event.currentTarget;
          const file = input.files?.[0];
          input.setCustomValidity(file && file.size > FILE_LIMIT ? "Choose a file up to 2 MB" : "");
        }} /></label>
        <div>
          <span className="label">Link to a task</span>
          <input type="hidden" name="task" value={linkedTask} />
          <Dropdown label="Link to a task" placeholder="Project file (no task)" value={linkedTask} onChange={setLinkedTask}
            options={[{ value: "", label: "Project file (no task)" }, ...d.tasks.map((task) => ({ value: task.id, label: task.title }))]} />
        </div>
        <p className="small">Source and HTML, PDF, PowerPoint and Word · up to 2 MB each</p>
        {state.error && <p className="err" role="alert">{state.error}</p>}
        {state.ok && <p className="small" role="status">{state.ok}</p>}
        <button className="btn" disabled={pending}>{pending ? "Sharing…" : "Share file"}</button>
      </form>
      {d.files.slice().reverse().map((entry) => (
        <FileCard key={entry.id} file={entry} slug={d.slug} className="task file-row"
          subtitle={`${titleOf(entry)} · ${byId.get(entry.member_id)?.name ?? "A teammate"}`} openFile={openFile} />
      ))}
    </section>
  );
}

function FileText({ url }: { url: string }) {
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch(url, { signal: controller.signal }).then((response) => {
      if (!response.ok) throw new Error("Preview unavailable");
      return response.text();
    }).then(setText).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [url]);
  return failed ? <p className="small">Preview unavailable</p> :
    text === null ? <p className="small">Loading preview…</p> : <pre className="file-source"><code>{text}</code></pre>;
}

// ---------- Tasks ----------
function TaskList({ d, byId, a, openFile }: Ctx) {
  const [title, setTitle] = useState("");
  return (
    <div>
      <div className="sec">
        <div className="sec-t">Tasks</div>
        {!d.tasks.length && <div className="small">Nothing here yet</div>}
        {d.tasks.map((t) => {
          const o = t.owner_member_id ? byId.get(t.owner_member_id) : undefined;
          const mine = o?.id === d.me.id;
          return (
            <div key={t.id} className={`task ${mine ? "mine" : ""}`}>
              <div className="top"><span className={t.status === "done" ? "strike" : ""}>{t.title}</span><Chip status={t.status} /></div>
              <div className="acts">
                <span className="owner">{o ? <><Dot color={o.color} />{mine ? "You" : o.name}</> : "Up for grabs"}</span>
                {!o && <button className="btn sm" onClick={() => a.claim(t)}>Claim</button>}
                {mine && t.status !== "doing" && <button className="ghost sm" onClick={() => a.status(t, "doing")}>{t.status === "done" ? "Reopen" : "Start"}</button>}
                {mine && t.status !== "done" && <button className="ghost sm" onClick={() => a.status(t, "done")}>Done</button>}
                {mine && <button className="linkbtn" onClick={() => a.unclaim(t)}>Unclaim</button>}
                <Dropdown compact label={`Hand ${t.title} to someone`} placeholder="Hand to…" onChange={(id) => a.reassign(t, id)}
                  options={d.members.filter((m) => m.id !== t.owner_member_id).map((m) => ({ value: m.id, label: m.id === d.me.id ? "Me" : m.name }))} />
              </div>
              {d.files.some((file) => file.task_id === t.id) && <div className="wrap-row task-files">
                {d.files.filter((file) => file.task_id === t.id).map((file) => (
                  <button className="ghost sm" key={file.id} onClick={() => openFile(file.id)}>📎 {file.name}</button>
                ))}
              </div>}
            </div>
          );
        })}
      </div>
      <form className="row" onSubmit={(e) => { e.preventDefault(); if (title.trim()) { a.addTask(title); setTitle(""); } }}>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="Add a task…" aria-label="New task" />
        <button className="ghost sm">Add</button>
      </form>
    </div>
  );
}

// ---------- Your AI: link and paste back ----------
function AiPanel({ d, a, toast }: { d: AppData; a: Actions; toast: (t: string, tone?: Toast["tone"]) => void }) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const blocks = useMemo(() => parseUpdates(text), [text]);
  const preview = blocks.map((b) => {
    if (b.error) return { title: b.task || "(no task)", ok: false, msg: b.error };
    const t = matchTask(d.tasks, b.task);
    if (!t) return { title: b.task, ok: false, msg: "No task with that title" };
    if (t.owner_member_id && t.owner_member_id !== d.me.id) return { title: t.title, ok: false, msg: `${d.members.find((m) => m.id === t.owner_member_id)?.name} owns this task` };
    const msg = [b.status === "done" ? "Marks it done" : b.status === "doing" ? "Marks it in progress" : "", !t.owner_member_id && "assigns it to you", b.note && "adds a note"].filter(Boolean).join(", ");
    return { title: t.title, ok: true, msg: msg.charAt(0).toUpperCase() + msg.slice(1), note: b.note };
  });
  const okCount = preview.filter((p) => p.ok).length;

  const copyText = async () => {
    const body = await (await fetch(`/a/${d.me.agent_token}`)).text();
    await copy(`Here is my group project context from Igloo. Help me with my tasks and report progress in the format at the end.\n\n${body}`);
    toast("Copied. Paste it into your AI chat.", "ok");
  };
  const save = async () => {
    setSaving(true);
    const r = await A.saveUpdates(d.slug, text);
    setSaving(false);
    const skipped = r.results?.filter((x) => !x.ok).map((x) => `${x.task}: ${x.message}`).join(" · ");
    if (r.error) toast(skipped ? `${r.error}. ${skipped}` : r.error, "bad");
    else { toast(r.ok ?? "Saved", "ok"); if (skipped) toast(`Skipped ${skipped}`, "bad"); setText(""); }
  };

  return (
    <div>
      <div className="sec">
        <div className="sec-t">1. Tell your AI about the project</div>
        <p className="small" style={{ margin: "0 0 12px" }}>Your private link tells your AI the brief, your tasks, shared files, and what the team agreed.</p>
        <div className="private">🔒 Private link for {d.me.name}</div>
        <div className="wrap-row">
          <button className="btn" onClick={a.copyAgent}>Copy link</button>
          <button className="ghost" onClick={copyText}>Copy as text</button>
          <a className="ghost" href={`/a/${d.me.agent_token}`} target="_blank" rel="noreferrer">Preview</a>
        </div>
        <p className="help"><b>ChatGPT, Claude or Gemini app?</b> Use Copy as text and paste it in.<br /><b>Claude Code, Codex or Cursor?</b> Give it the link. It can post updates by itself.</p>
        <button className="linkbtn" style={{ fontSize: 11, textDecoration: "underline" }}
          onClick={() => copy(`claude mcp add --transport http igloo "${location.origin}/api/mcp?token=${d.me.agent_token}"`).then(() => toast("Copied. Run it where you use Claude Code.", "ok"))}>
          Advanced: connect Claude directly (MCP)
        </button>
      </div>
      <div className="sec">
        <div className="sec-t">2. Paste what your AI said back</div>
        <textarea className="input" rows={6} value={text} onChange={(e) => setText(e.target.value)} aria-label="Your AI's reply"
          placeholder={"IGLOO UPDATE\ntask: Pitch deck\nstatus: doing\nnote: outline drafted, 8 slides"} />
        {text && !preview.length && <p className="small">Nothing to save yet. Your AI's reply should include a block that starts with IGLOO UPDATE.</p>}
        {preview.map((p, i) => (
          <div key={i} className={`preview ${p.ok ? "ok" : "bad"}`}>
            <div style={{ fontWeight: 500, color: "var(--text)" }}>{p.title}</div>
            <div className={p.ok ? "small" : ""}>{p.msg}</div>
            {p.ok && p.note && <div className="small">“{p.note}”</div>}
          </div>
        ))}
        {okCount > 0 && <button className="btn" style={{ width: "100%", marginTop: 8 }} disabled={saving} onClick={save}>{saving ? "Saving…" : `Save ${okCount} update${okCount > 1 ? "s" : ""}`}</button>}
      </div>
    </div>
  );
}

// ---------- What's new ----------
function Feed({ d, byId }: Ctx) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 30_000); return () => clearInterval(t); }, []);
  return (
    <div>
      <div className="live"><span className="dot" />Live</div>
      {d.activity.map((x) => (
        <div key={x.id} className="ev">
          <Dot color={(x.member_id && byId.get(x.member_id)?.color) || "var(--muted)"} />
          <span className="msg">{x.message}</span>
          <span className="small">{timeAgo(x.created_at)}</span>
        </div>
      ))}
    </div>
  );
}

// ---------- Decisions ----------
function Decisions({ d, byId, a }: Ctx) {
  const [text, setText] = useState("");
  const pending = d.decisions.filter((x) => !x.approved_by);
  const locked = d.decisions.filter((x) => x.approved_by);
  const who = (id: string | null) => (id === d.me.id ? "you" : byId.get(id ?? "")?.name ?? "someone");
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  return (
    <div>
      <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) { a.propose(text); setText(""); } }}>
        <textarea className="input" rows={2} maxLength={300} value={text} onChange={(e) => setText(e.target.value)} aria-label="Suggestion"
          placeholder="Suggest something the team should agree on, like: Deck uses the blue theme" />
        <button className="btn" style={{ width: "100%", marginTop: 8, padding: 8 }}>Suggest to the team</button>
        <p className="small" style={{ margin: "8px 0 20px" }}>When someone else agrees, it is locked in and every AI on the team will follow it.</p>
      </form>
      <div className="sec">
        <div className="sec-t">Waiting for a yes · {pending.length}</div>
        {!pending.length && <div className="small">Nothing waiting</div>}
        {pending.map((x) => (
          <div key={x.id} className="dec-wait">
            <div>{x.text}</div>
            <div className="dec-foot small">
              <span>Suggested by {who(x.created_by)}</span>
              {x.created_by === d.me.id ? <span>Waiting for a teammate</span> : <button className="btn sm" onClick={() => a.approve(x.id)}>Agree</button>}
            </div>
          </div>
        ))}
      </div>
      <div className="sec">
        <div className="sec-t">Agreed · {locked.length}</div>
        {locked.map((x) => (
          <div key={x.id} className="dec">
            <div>🔒 {x.text}</div>
            <div className="small" style={{ marginTop: 4 }}>{cap(who(x.created_by))} suggested · {who(x.approved_by)} agreed</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- Quick actions (N or Cmd K) ----------
function Palette({ d, a, close, setView, setTab }: Ctx & { close: () => void; setView: (v: "board" | "list") => void; setTab: (t: Tab) => void }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const cmds = useMemo(() => {
    const list: { label: string; hint?: string; run: () => void }[] = [];
    for (const t of d.tasks) {
      if (!t.owner_member_id) list.push({ label: `Claim: ${t.title}`, run: () => a.claim(t) });
      if (t.owner_member_id === d.me.id && t.status === "todo") list.push({ label: `Start: ${t.title}`, hint: "mine", run: () => a.status(t, "doing") });
      if (t.owner_member_id === d.me.id && t.status !== "done") list.push({ label: `Mark done: ${t.title}`, hint: "mine", run: () => a.status(t, "done") });
    }
    for (const x of d.decisions) if (!x.approved_by && x.created_by !== d.me.id) list.push({ label: `Agree: ${x.text}`, hint: "decision", run: () => a.approve(x.id) });
    list.push(
      { label: "Copy link for my AI", run: a.copyAgent },
      { label: "Copy update for group chat", run: a.copyDigest },
      { label: "Copy invite", run: a.copyInvite },
      { label: "Show board", run: () => setView("board") },
      { label: "Show list", run: () => setView("list") },
      { label: "Paste what my AI said", run: () => setTab("ai") },
      { label: "See what's new", run: () => setTab("activity") },
      { label: "Open decisions", run: () => setTab("decisions") },
    );
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const hits = list.filter((c) => words.every((w) => c.label.toLowerCase().includes(w)));
    if (q.trim()) hits.push(
      { label: `Add task: ${q.trim()}`, run: () => a.addTask(q) },
      { label: `Suggest decision: ${q.trim()}`, run: () => a.propose(q) },
    );
    return hits.slice(0, 12);
  }, [q, d, a, setView, setTab]);
  const go = (i: number) => { const c = cmds[i]; if (c) { c.run(); close(); } };

  return (
    <div className="scrim" onMouseDown={close}>
      <div className="palette" role="dialog" aria-label="Quick actions" onMouseDown={(e) => e.stopPropagation()}>
        <input autoFocus value={q} placeholder="What do you want to do? Try a task name, or type a new one…" aria-label="Search actions"
          onChange={(e) => { setQ(e.target.value); setSel(0); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, cmds.length - 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
            if (e.key === "Enter") go(sel);
          }} />
        <div className="items">
          {cmds.map((c, i) => (
            <button key={c.label} className={`item ${i === sel ? "sel" : ""}`} onMouseEnter={() => setSel(i)} onClick={() => go(i)}>
              <span>{c.label}</span>{c.hint && <span className="small">{c.hint}</span>}
            </button>
          ))}
          {!cmds.length && <div className="small" style={{ padding: "8px 12px" }}>No matches</div>}
        </div>
        <div className="foot"><span>↑↓ move</span><span>↵ run</span><span>esc close</span></div>
      </div>
    </div>
  );
}
