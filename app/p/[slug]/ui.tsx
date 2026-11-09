"use client";
// The whole group page, laid out like docs/group-page-sample.html.
import { useActionState, useCallback, useEffect, useMemo, useOptimistic, useRef, useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import * as A from "@/app/actions";
import { Aurora } from "@/components/ui/aurora";
import { Dropdown } from "./dropdown";
import { FileThumbnail } from "./file-thumbnail";
import {
  AI_TOOLS, FILE_ACCEPT, FILE_LABEL, FILE_LIMIT, buildDigest, cleanUrl, daysLeft, dueLabel, fileUrl, isToken, linkService, matchTask, parseUpdates, taskDue, timeAgo,
  type Activity, type Decision, type MemberPublic, type ProjectFile, type Result, type Status, type Task, type TaskNote,
} from "@/lib/core";

const STATUS_LABEL: Record<Status, string> = { todo: "To do", doing: "In progress", done: "Done" };
const Chip = ({ status }: { status: Status }) => <span className={`chip ${status}`}>{STATUS_LABEL[status]}</span>;
const Dot = ({ color, title }: { color: string; title?: string }) => <span className="dot" style={{ background: color }} title={title} />;

// The clipboard API is missing on plain http (a Wi-Fi address) and can be refused, so fall back to execCommand.
// Rejects if both fail, so callers can say so instead of claiming it copied.
async function copy(text: string) {
  if (navigator.clipboard && window.isSecureContext) {
    try { return await navigator.clipboard.writeText(text); } catch { /* try the old way */ }
  }
  const ta = document.createElement("textarea");
  ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta); ta.select();
  const ok = document.execCommand("copy");
  ta.remove();
  if (!ok) throw new Error("copy failed");
}
// Side panel: floats over the board on wide screens; this much width stays clear for the board when it's open.
const PANEL_KEY = "igloo-panel";
const WIDE = "(min-width: 861px)";
const PANEL_SPACE = 404; // 380px panel + 12px gap on each side
const COPY_FAILED = "Couldn't copy. Your browser blocked the clipboard, so try again.";
// Top bar due date, short: "9d" while there's time left; "due today" and "2d overdue" stay spelled out.
const shortDue = (due: string) => { const n = daysLeft(due); return n > 0 ? `${n}d` : dueLabel(due); };

// ======================= Join =======================
export function JoinForm({ slug, name, context, code }: { slug: string; name: string; context: string; code?: string }) {
  const [state, action, pending] = useActionState(A.joinProject, undefined);
  const [tool, setTool] = useState("Claude");
  // Controlled so a wrong code doesn't wipe them: React resets uncontrolled fields after a form action.
  const [memberName, setMemberName] = useState("");
  const [otherTool, setOtherTool] = useState("");
  const [joinCode, setJoinCode] = useState(code ?? "");
  const [alreadyIn, setAlreadyIn] = useState(false);
  if (alreadyIn) return <DeviceForm slug={slug} name={name} back={() => setAlreadyIn(false)} />;
  return (
    <main className="page landing">
      <Aurora className="canvas-aurora" />
      <a href="/" className="igloo-wordmark" aria-label="Igloo home">igloo.</a>
      <div className="page-inner narrow">
        <div className="ctx">{context || "Igloo"}</div>
        <h1>Join {name}</h1>
        <p className="lead">Keep using your own AI. This is where your team and your AIs meet.</p>
        {code && <div className="hint">Your project is ready. Join it yourself first, then invite your team.</div>}
        <form action={action} className="card form lp-join">
          <input type="hidden" name="slug" value={slug} />
          <div>
            <label className="label" htmlFor="name">Your name</label>
            <input id="name" name="name" required maxLength={40} autoFocus className="input" value={memberName} onChange={(e) => setMemberName(e.target.value)} placeholder="Aisha" />
          </div>
          <div>
            <span className="label">Your AI</span>
            <div className="lp-ai-grid">
              {AI_TOOLS.map((t) => {
                const logo = aiLogo(t);
                return (
                  <button key={t} type="button" className={tool === t ? "on" : ""} aria-pressed={tool === t} title={t} onClick={() => setTool(t)}>
                    {logo ? <img src={logo} alt={t} /> : t}
                  </button>
                );
              })}
            </div>
            {tool === "Other"
              ? <input name="ai_tool" required maxLength={40} className="input" style={{ marginTop: 8 }} value={otherTool} onChange={(e) => setOtherTool(e.target.value)} placeholder="Which AI?" aria-label="Which AI" />
              : <input type="hidden" name="ai_tool" value={tool} />}
          </div>
          <div>
            <label className="label" htmlFor="code">Join code</label>
            <input id="code" name="code" required inputMode="numeric" pattern="\d{6}" maxLength={6} value={joinCode} onChange={(e) => setJoinCode(e.target.value)} className="input code-input" placeholder="000000" />
          </div>
          {state?.error && <p className="err">{state.error}</p>}
          <button className="btn big" disabled={pending}>{pending ? "Joining…" : "Join project"}</button>
        </form>
        <button className="ghost big rejoin-button" type="button" onClick={() => setAlreadyIn(true)}>I’m already in</button>
      </div>
    </main>
  );
}

// Open an existing membership on this browser with a one-time rejoin link.
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
  return (
    <main className="page landing">
      <Aurora className="canvas-aurora" />
      <a href="/" className="igloo-wordmark" aria-label="Igloo home">igloo.</a>
      <div className="page-inner narrow">
        <div className="ctx">Igloo · Existing membership</div>
        <h1>Rejoin {name}</h1>
        <p className="lead">Use the same name, tasks, and private agent link on this browser.</p>
        <form className="card form lp-join" action={action}>
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="device" value={device ?? ""} />
          {back && <label className="label">Private rejoin link
            <input className="input" type="text" value={pastedLink} onChange={(event) => setPastedLink(event.target.value)} maxLength={512} autoComplete="off" spellCheck={false} style={{ marginTop: 6 }} />
            <span className="small">On the browser where you’re already in this project, click Copy rejoin link.</span>
          </label>}
          {state?.error && <p className="err" role="alert">{state.error}</p>}
          <button className="btn big" disabled={pending || !device}>{pending ? "Rejoining…" : "Continue with my membership"}</button>
          {!back && !code && <p className="small">If you don’t have a code here, reopen the original rejoin link.</p>}
        </form>
        {back && <button className="ghost big rejoin-button" type="button" onClick={back}>Back to join</button>}
      </div>
    </main>
  );
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
  latestNotes: Record<string, TaskNote>;
};
type Tab = "tasks" | "files" | "ai" | "activity" | "decisions";
type Toast = { id: number; text: string; tone: "ok" | "bad" | "info" };
type Actions = ReturnType<typeof useActions>;
type Filter = "all" | "mine" | "open" | "doing";
// Task panel state lives in App, so the filter and open cards survive switching tabs and views.
type TaskUi = { filter: Filter; setFilter: (f: Filter) => void; open: Set<string>; toggle: (id: string) => void; useAi: (t: Task) => void };
type Ctx = { d: AppData; byId: Map<string, MemberPublic>; a: Actions; ui: TaskUi; openFile: (id: string) => void };

type TaskPatch = { id: string; changes: Partial<Task> };
function useActions(d: AppData, toast: (t: string, tone?: Toast["tone"]) => void, patch: (p: TaskPatch) => void) {
  const [, start] = useTransition();
  // Resolves with the result, so a card can show its own busy state and error.
  // quiet: the caller shows the error itself (a task card does, inline), so skip the error toast.
  // optimistic: shown at once and kept until the board refreshes; React drops it if the server refused.
  const run = (call: () => Promise<Result>, okText?: string, quiet = false, optimistic?: TaskPatch) => new Promise<Result>((resolve) => start(async () => {
    if (optimistic) patch(optimistic);
    const r: Result = await call().catch(() => ({ error: "Couldn't reach Igloo. Check your connection and try again." }));
    if (r.error) { if (!quiet) toast(r.error, "bad"); }
    else if (r.ok && r.ok !== "No change") toast(okText ?? r.ok, "ok");
    resolve(r);
  }));
  const now = () => new Date().toISOString();
  const groupUrl = () => `${location.origin}/p/${d.slug}`;
  const statusText = (t: Task, s: Status) =>
    s === "done" ? `Marked “${t.title}” done` : s === "doing" ? (t.status === "done" ? `Reopened “${t.title}”` : `Started “${t.title}”`) : undefined;
  const nameOf = (id: string) => (id === d.me.id ? "you" : d.members.find((m) => m.id === id)?.name ?? "them");
  return {
    claim: (t: Task, quiet?: boolean) => run(() => A.claim(d.slug, t.id), `You claimed “${t.title}”`, quiet,
      t.owner_member_id ? undefined : { id: t.id, changes: { owner_member_id: d.me.id, claimed_at: now() } }),
    status: (t: Task, s: Status, quiet?: boolean) => run(() => A.setStatus(d.slug, t.id, s), statusText(t, s), quiet,
      !t.owner_member_id || t.owner_member_id === d.me.id
        ? { id: t.id, changes: { status: s, done_at: s === "done" ? now() : null, owner_member_id: d.me.id, claimed_at: t.claimed_at ?? now() } }
        : undefined),
    unclaim: (t: Task, quiet?: boolean) => run(() => A.unclaim(d.slug, t.id), `Unclaimed “${t.title}”. It's up for grabs again.`, quiet,
      t.owner_member_id === d.me.id ? { id: t.id, changes: { owner_member_id: null, status: "todo", claimed_at: null, done_at: null } } : undefined),
    reassign: (t: Task, m: string, quiet?: boolean) => run(() => A.reassign(d.slug, t.id, m), `Handed “${t.title}” to ${nameOf(m)}`, quiet,
      { id: t.id, changes: { owner_member_id: m, claimed_at: now(), ...(t.status === "done" ? { status: "doing" as const, done_at: null } : {}) } }),
    setDue: (t: Task, due: string | null, quiet?: boolean) => run(() => A.setDue(d.slug, t.id, due), due ? `Deadline for “${t.title}” set to ${taskDue(due, "done")?.text.replace(/^Due /, "")}` : `Cleared the deadline on “${t.title}”`, quiet,
      { id: t.id, changes: { due_date: due } }),
    addTask: (title: string) => run(() => A.addTask(d.slug, title)),
    propose: (text: string) => run(() => A.proposeDecision(d.slug, text)),
    approve: (id: string) => run(() => A.approveDecision(d.slug, id)),
    deleteFile: (file: ProjectFile, after?: () => void) => {
      if (!window.confirm(`Delete ${file.name} for everyone? This can't be undone.`)) return;
      run(async () => { const r = await A.deleteFile(d.slug, file.id); if (!r.error) after?.(); return r; });
    },
    copyDigest: () => copy(buildDigest(d.project, d.members, d.tasks, groupUrl())).then(() => toast("Update copied. Paste it in your group chat.", "ok"), () => toast(COPY_FAILED, "bad")),
    copyAgent: () => copy(`${location.origin}/a/${d.me.agent_token}`).then(() => toast("Link copied. Paste it into your AI, and keep it private.", "ok"), () => toast(COPY_FAILED, "bad")),
    copyInvite: () => copy(`Join ${d.project.name} on Igloo\n${groupUrl()}\nCode: ${d.project.join_code}`).then(() => toast("Invite copied", "ok"), () => toast(COPY_FAILED, "bad")),
  };
}

export function App(props: AppData) {
  // Task buttons update this copy right away, before the server confirms.
  const [tasks, patchTasks] = useOptimistic(props.tasks, (ts: Task[], p: TaskPatch) =>
    ts.map((t) => (t.id === p.id ? { ...t, ...p.changes } : t)));
  const d = useMemo(() => ({ ...props, tasks }), [props, tasks]);
  const router = useRouter();
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [copyingDevice, setCopyingDevice] = useState(false);
  const [deviceLink, setDeviceLink] = useState<string | null>(null);
  const [view, setView] = useState<"board" | "list">("board");
  const [tab, setTab] = useState<Tab>("tasks");
  const [palette, setPalette] = useState(false);
  // ⌘ on Macs, Ctrl elsewhere. Read after mount so the server and first render agree.
  const [modKey, setModKey] = useState("⌘");
  useEffect(() => { if (!/mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent)) setModKey("Ctrl "); }, []);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [aiTaskId, setAiTaskId] = useState<string | null>(null);
  // The side panel floats over the board on wide screens and can be hidden. Remembered on this browser only.
  const [panel, setPanel] = useState(true);
  const [wide, setWide] = useState(true);
  useEffect(() => {
    try { if (localStorage.getItem(PANEL_KEY) === "hidden") setPanel(false); } catch { /* storage blocked: stay open */ }
    const mq = window.matchMedia(WIDE);
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const showPanel = useCallback((v: boolean) => {
    setPanel(v);
    try { localStorage.setItem(PANEL_KEY, v ? "shown" : "hidden"); } catch { /* fine: it just won't be remembered */ }
  }, []);
  const openTab = useCallback((t: Tab) => { setTab(t); showPanel(true); }, [showPanel]);
  const byId = useMemo(() => new Map(d.members.map((m) => [m.id, m])), [d.members]);
  const ui: TaskUi = useMemo(() => ({
    filter, setFilter, open,
    toggle: (id) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }),
    useAi: (t) => { setAiTaskId(t.id); openTab("ai"); },
  }), [filter, open, openTab]);
  // Only my own tasks can be the AI focus; drop it if the task left me.
  const aiTask = d.tasks.find((t) => t.id === aiTaskId && t.owner_member_id === d.me.id) ?? null;

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

  const openFile = (id: string) => { setSelectedFile(id); openTab("files"); };
  const openFiles = () => { setSelectedFile(null); openTab("files"); };
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
  const ctx = { d, byId, a, ui, openFile };
  const done = d.tasks.filter((t) => t.status === "done").length;
  const waiting = d.decisions.some((x) => !x.approved_by);

  return (
    <div className="app">
      <Aurora className="canvas-aurora" />
      {/* Brand: top left of the page, outside the top bar. */}
      <a href="/" className="igloo-wordmark" aria-label="Igloo home">igloo.</a>
      <header>
        <div className="proj">
          <div className="ctx">{[d.project.course_or_context, d.project.due_date && shortDue(d.project.due_date)].filter(Boolean).join(" · ") || "Igloo"}</div>
          <div className="title">{d.project.name}</div>
        </div>
        <span className="pill" title={`${done} of ${d.tasks.length} tasks done`} aria-label={`${done} of ${d.tasks.length} tasks done`}>{done}/{d.tasks.length}</span>
        <div className="hright">
          <div className="seg" role="group" aria-label="View">
            {(["board", "list"] as const).map((v) => (
              <button key={v} className={`view-btn ${view === v ? "on" : ""}`} aria-pressed={view === v} onClick={() => setView(v)}
                aria-label={v === "board" ? "Board view" : "List view"} title={v === "board" ? "Board" : "List"}>
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  {v === "board"
                    ? <><circle cx="8" cy="8" r="2.2" /><circle cx="3" cy="3.5" r="1.5" /><circle cx="13" cy="3.5" r="1.5" /><circle cx="8" cy="13.5" r="1.5" /><path d="M4.2 4.6 6.4 6.6M11.8 4.6 9.6 6.6M8 10.2v1.8" /></>
                    : <><path d="M6 4h7.5M6 8h7.5M6 12h7.5" /><circle cx="2.8" cy="4" r=".6" fill="currentColor" /><circle cx="2.8" cy="8" r=".6" fill="currentColor" /><circle cx="2.8" cy="12" r=".6" fill="currentColor" /></>}
                </svg>
              </button>
            ))}
          </div>
          {/* Icon buttons: the name is in the tooltip and for screen readers. */}
          <button className="ghost icon-btn" onClick={a.copyInvite} title="Invite: copy the group link and join code" aria-label="Invite teammates">
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 10V2M5 4.5 8 1.5l3 3" /><path d="M5.5 7H4a1.5 1.5 0 0 0-1.5 1.5v4A1.5 1.5 0 0 0 4 14h8a1.5 1.5 0 0 0 1.5-1.5v-4A1.5 1.5 0 0 0 12 7h-1.5" />
            </svg>
          </button>
          <button className="ghost icon-btn" onClick={openFiles} title="Add a file or link" aria-label="Add a file or link">
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13.5 7.5 8.2 12.8a3.3 3.3 0 0 1-4.7-4.7l5.6-5.6a2.2 2.2 0 0 1 3.1 3.1L6.6 11.2a1.1 1.1 0 0 1-1.6-1.6l5-5" />
            </svg>
          </button>
          <button className="btn icon-btn" onClick={a.copyDigest} title="Copy summary for the group chat" aria-label="Copy summary for the group chat">
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
              <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" /><path d="M10.5 5.5V4A1.5 1.5 0 0 0 9 2.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5" />
            </svg>
          </button>
          <button className="ghost qa" onClick={() => setPalette(true)} title={`Quick actions (N or ${modKey}K)`} aria-label="Quick actions">
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden><path d="M9 1.5 3 9h4.5L7 14.5 13 7H8.5L9 1.5Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>
            <kbd>{modKey}K</kbd>
          </button>
          <div className="me">
            <Dot color={d.me.color} />{d.me.name}
            <button className="linkbtn" onClick={copyRejoin} disabled={copyingDevice} title="Open your membership on another browser">Copy rejoin link</button>
            <form action={A.leaveDevice}>
              <input type="hidden" name="slug" value={d.slug} />
              <button className="linkbtn" title="Not you? Switch person on this device">Switch</button>
            </form>
          </div>
        </div>
      </header>
      {deviceLink && <div className="hint device-link">
        <label className="label">Private rejoin link (one use, 10 minutes)
          <input className="input" readOnly value={deviceLink} onFocus={(event) => event.currentTarget.select()} />
        </label>
        <button className="linkbtn" onClick={() => setDeviceLink(null)}>Dismiss</button>
      </div>}

      <div className={`body ${panel ? "panel-open" : "panel-hidden"}`}>
        <main>
          {!panel && (
            <button className="panel-show" onClick={() => showPanel(true)} aria-controls="side-panel" aria-expanded={false}>
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><path d="M7.5 3 4.5 6l3 3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
              Tasks and team
            </button>
          )}
          {view === "board" ? <Board {...ctx} panelSpace={wide && panel ? PANEL_SPACE : 0} /> : (
            <div className="list dots">
              <div className="stack">
                <div className="card"><TaskList {...ctx} /></div>
              </div>
            </div>
          )}
        </main>
        <aside id="side-panel">
          <nav>
            <div role="tablist" className="tabs">
              {([["tasks", "Tasks"], ["files", "Files"], ["ai", "Your AI"], ["activity", "What's new"], ["decisions", "Decisions"]] as const).map(([k, label]) => (
                <button key={k} role="tab" aria-selected={panel && tab === k} className={panel && tab === k ? "on" : ""} onClick={() => openTab(k)}>
                  {label}{k === "decisions" && waiting && <span className="badge" aria-label="waiting for a yes">•</span>}
                </button>
              ))}
            </div>
            <button className="panel-toggle" onClick={() => showPanel(!panel)} aria-controls="side-panel" aria-expanded={panel}
              aria-label={panel ? "Hide the side panel" : "Show the side panel"} title={panel ? "Hide panel" : "Show panel"}>
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
                <path d={panel ? (wide ? "M4.5 3l3 3-3 3" : "M3 7.5 6 4.5l3 3") : "M3 4.5 6 7.5l3-3"} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </nav>
          {panel && <div className="pane">
            {tab === "tasks" && <TaskList {...ctx} />}
            {tab === "files" && <FilesPanel d={d} byId={byId} selected={selectedFile} openFile={openFile} back={openFiles} remove={a.deleteFile} />}
            {tab === "ai" && <AiPanel d={d} a={a} toast={toast} task={aiTask} clearTask={() => setAiTaskId(null)} />}
            {tab === "activity" && <Feed {...ctx} />}
            {tab === "decisions" && <Decisions {...ctx} />}
          </div>}
        </aside>
      </div>

      {palette && <Palette {...ctx} close={() => setPalette(false)} setView={setView} setTab={openTab} panel={panel} showPanel={showPanel} />}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.tone}`}>{t.tone === "ok" ? "✓ " : ""}{t.text}</div>)}
      </div>
    </div>
  );
}

// ---------- Board ----------
// A fixed stage, scaled to fit. With 4 members it is the sample's layout (1100 x 790); more members widen the ring.
// Icons from Lucide (https://lucide.dev), ISC License, Copyright (c) Lucide Contributors.
const BOARD_ICONS = {
  research: <><path d="m21 21-4.34-4.34" /><circle cx="11" cy="11" r="8" /></>,
  build: <><path d="m15 12-9.373 9.373a1 1 0 0 1-3.001-3L12 9" /><path d="m18 15 4-4" /><path d="m21.5 11.5-1.914-1.914A2 2 0 0 1 19 8.172v-.344a2 2 0 0 0-.586-1.414l-1.657-1.657A6 6 0 0 0 12.516 3H9l1.243 1.243A6 6 0 0 1 12 8.485V10l2 2h1.172a2 2 0 0 1 1.414.586L18.5 14.5" /></>,
  present: <><path d="M2 3h20" /><path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3" /><path d="m7 21 5-5 5 5" /></>,
  decisions: <><circle cx="12" cy="12" r="10" /><path d="m16 9-5.5 5.5L8 12" /></>,
  due: <><path d="M8 2v3" /><path d="M16 2v3" /><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18" /></>,
  minus: <path d="M5 12h14" />,
  plus: <><path d="M5 12h14" /><path d="M12 5v14" /></>,
  fit: <><path d="M8 3H5a2 2 0 0 0-2 2v3" /><path d="M21 8V5a2 2 0 0 0-2-2h-3" /><path d="M3 16v3a2 2 0 0 0 2 2h3" /><path d="M16 21h3a2 2 0 0 0 2-2v-3" /></>,
  lock: <><rect width="18" height="11" x="3" y="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>,
  ai: <><path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" /><path d="M2 14h2" /><path d="M20 14h2" /><path d="M15 13v2" /><path d="M9 13v2" /></>,
};

function BoardIcon({ name }: { name: keyof typeof BOARD_ICONS }) {
  return <svg className="board-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{BOARD_ICONS[name]}</svg>;
}

const aiName = (tool: string) => (tool === "Other" ? "their AI" : tool);
// Brand logos in public/ai, from @lobehub/icons (MIT). Marks belong to their owners.
const AI_LOGOS = ["claude", "chatgpt", "gemini", "cursor", "copilot"];
const aiLogo = (tool: string) => {
  const key = tool.trim().toLowerCase();
  return AI_LOGOS.includes(key) ? `/ai/${key}.svg` : null;
};

// The one thing this person should do now, in board order.
function nextStep(d: AppData, a: Actions) {
  const tasks = d.tasks;
  const mine = tasks.filter((t) => t.owner_member_id === d.me.id);
  const doing = mine.find((t) => t.status === "doing");
  if (doing) return { label: "You're on", task: doing, action: "Mark done", run: () => a.status(doing, "done") };
  const todo = mine.find((t) => t.status === "todo");
  if (todo) return { label: "Your next", task: todo, action: "Start", run: () => a.status(todo, "doing") };
  const open = tasks.find((t) => !t.owner_member_id && t.status === "todo");
  if (open) return { label: "Up next", task: open, action: "Claim", run: () => a.claim(open) };
  return null;
}

const clampZoom = (v: number) => Math.min(2, Math.max(0.25, v));
const ZOOM_BAR_SPACE = 60; // Height kept clear at the bottom so cards fit above the zoom bar.

// Default spots, in stage units with the project card at 0,0. Tasks sit in a grid under it;
// files and links get their own free-standing area below the tasks, with no lines.
const TASK_W = 240, TASK_GAP_X = 24, TASK_ROW = 170, FILE_W = 245, FILE_ROW = 220;
function defaultSpots(taskIds: string[], fileIds: string[], brainH: number) {
  const spots: Record<string, { x: number; y: number }> = {};
  const cols = Math.min(4, Math.max(taskIds.length, 1));
  const top = Math.max(210, brainH / 2 + 140);
  taskIds.forEach((id, i) => {
    const row = Math.floor(i / cols), inRow = Math.min(cols, taskIds.length - row * cols), col = i % cols;
    spots[id] = { x: (col - (inRow - 1) / 2) * (TASK_W + TASK_GAP_X), y: top + row * TASK_ROW };
  });
  const fileTop = top + Math.ceil(taskIds.length / cols) * TASK_ROW + 90;
  const fileCols = Math.min(4, Math.max(fileIds.length, 1));
  fileIds.forEach((id, i) => {
    const row = Math.floor(i / fileCols), inRow = Math.min(fileCols, fileIds.length - row * fileCols), col = i % fileCols;
    spots[id] = { x: (col - (inRow - 1) / 2) * (FILE_W + 40), y: fileTop + row * FILE_ROW };
  });
  return spots;
}

// panelSpace: width on the right covered by the floating side panel; the board fits and centres in the rest.
function Board({ d, a, byId, openFile, panelSpace = 0 }: Ctx & { panelSpace?: number }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 30_000); return () => clearInterval(t); }, []);
  const next = nextStep(d, a);
  const reserve = next ? 64 : 0; // Height kept clear for the next-step bar.
  const files = useMemo(() => d.files.slice().reverse(), [d.files]);
  const [brainH, setBrainH] = useState(0);
  const defaults = useMemo(() => defaultSpots(d.tasks.map((t) => t.id), files.map((f) => f.id), brainH), [d.tasks, files, brainH]);
  // Where this viewer dragged cards. Kept in this browser only.
  const storeKey = `igloo-layout:${d.slug}`;
  const [moved, setMoved] = useState<Record<string, { x: number; y: number }>>({});
  useEffect(() => {
    try { setMoved(JSON.parse(localStorage.getItem(storeKey) ?? "{}")); } catch { /* no saved layout */ }
  }, [storeKey]);
  const spot = (id: string) => moved[id] ?? defaults[id] ?? { x: 0, y: 0 };

  // The stage covers every card. It only grows or shrinks when a drag ends, so the board doesn't jump mid-drag.
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const frameRef = useRef({ minX: -200, minY: -160, maxX: 200, maxY: 160 });
  if (!draggingId) {
    const half = Math.max(brainH / 2, 120);
    const xs = [-180, 180], ys = [-half, half];
    for (const t of d.tasks) { const p = spot(t.id); xs.push(p.x - TASK_W / 2, p.x + TASK_W / 2); ys.push(p.y - 80, p.y + 80); }
    for (const f of files) { const p = spot(f.id); xs.push(p.x - FILE_W / 2, p.x + FILE_W / 2); ys.push(p.y - 100, p.y + 100); }
    frameRef.current = { minX: Math.min(...xs) - 30, minY: Math.min(...ys) - 30, maxX: Math.max(...xs) + 30, maxY: Math.max(...ys) + 30 };
  }
  const { minX, minY, maxX, maxY } = frameRef.current;
  const W = maxX - minX, H = maxY - minY;

  const box = useRef<HTMLDivElement>(null);
  const [fitScale, setFitScale] = useState(0);
  // zoom is null while the board auto-fits; a number once someone takes control.
  const [zoom, setZoom] = useState<number | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const panStart = useRef<{ x: number; y: number } | null>(null);
  const scale = zoom ?? fitScale;
  const zoomStep = (dir: number) => setZoom(clampZoom((Math.round(scale * 10) + dir) / 10));
  const fitBoard = () => { setZoom(null); setPan({ x: 0, y: 0 }); };
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => {
      setBrainH(el.querySelector<HTMLElement>(".brain")?.offsetHeight ?? 0);
      const next = Math.min(Math.max(el.clientWidth - panelSpace, 200) / (W + 64), Math.max(el.clientHeight - reserve - ZOOM_BAR_SPACE, 120) / (H + 24), 1);
      setFitScale((f) => (f === next ? f : next));
    };
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    fit();
    return () => ro.disconnect();
  }, [W, H, reserve, panelSpace]);
  // Scrolling over the zoom bar zooms. So does Ctrl/Cmd + scroll anywhere, which is also what a trackpad pinch sends.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey && !(e.target as HTMLElement).closest(".zoom-bar")) return;
      e.preventDefault();
      setZoom((z) => clampZoom((z ?? fitScale) * Math.exp(-e.deltaY * 0.002)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [fitScale]);

  // Pan the empty board once zoomed in.
  const startPan = (e: React.PointerEvent<HTMLDivElement>) => {
    if (zoom === null || (e.target as HTMLElement).closest(".node, .next-step, .zoom-bar, .board-reset")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    panStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
    setPanning(true);
  };
  const movePan = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!panStart.current) return;
    const { clientWidth: w, clientHeight: h } = e.currentTarget;
    setPan({ x: Math.max(-w, Math.min(w, e.clientX - panStart.current.x)), y: Math.max(-h, Math.min(h, e.clientY - panStart.current.y)) });
  };
  const endPan = () => { panStart.current = null; setPanning(false); };

  // Drag any task or file card by its body. A press that barely moves is still a normal click.
  const drag = useRef<{ id: string; px: number; py: number; x: number; y: number; moved: boolean } | null>(null);
  const onNodeDown = (id: string) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("select, input, .dropdown, .acts button")) return;
    e.stopPropagation();
    const p = spot(id);
    drag.current = { id, px: e.clientX, py: e.clientY, x: p.x, y: p.y, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onNodeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = drag.current;
    if (!g || !scale) return;
    const dx = (e.clientX - g.px) / scale, dy = (e.clientY - g.py) / scale;
    if (!g.moved && Math.hypot(dx, dy) < 4) return;
    if (!g.moved) { g.moved = true; setDraggingId(g.id); }
    setMoved((m) => ({ ...m, [g.id]: { x: Math.round(g.x + dx), y: Math.round(g.y + dy) } }));
  };
  const onNodeUp = () => {
    const g = drag.current;
    drag.current = null;
    if (!g?.moved) return;
    setDraggingId(null);
    setMoved((m) => { try { localStorage.setItem(storeKey, JSON.stringify(m)); } catch { /* storage blocked */ } return m; });
    // Swallow the click that follows a drag, so dropping a file doesn't open it.
    window.addEventListener("click", (ev) => { ev.stopPropagation(); ev.preventDefault(); }, { capture: true, once: true });
  };
  const handlers = (id: string) => ({ onPointerDown: onNodeDown(id), onPointerMove: onNodeMove, onPointerUp: onNodeUp, onPointerCancel: onNodeUp });
  const resetLayout = () => { setMoved({}); try { localStorage.removeItem(storeKey); } catch { /* storage blocked */ } };
  const locked = d.decisions.filter((x) => x.approved_by).length;
  const done = d.tasks.filter((t) => t.status === "done").length;
  const at = (p: { x: number; y: number }) => ({ left: p.x - minX, top: p.y - minY });

  return (
    <div ref={box} className={`board dots ${zoom !== null ? "zoomed" : ""} ${panning ? "panning" : ""}`} onPointerDown={startPan} onPointerMove={movePan} onPointerUp={endPan} onPointerCancel={endPan} style={{ "--panel": `${panelSpace}px` } as CSSProperties}>
      {next && (
        <div className="next-step">
          <span className="next-label">{next.label}</span>
          <span className="next-task" title={next.task.title}>{next.task.title}</span>
          <button className="btn sm" onClick={next.run}>{next.action}</button>
        </div>
      )}
      {Object.keys(moved).length > 0 && <button className="ghost sm board-reset" onClick={resetLayout}>Reset layout</button>}
      <div className="stage" style={{ left: `calc(50% - ${panelSpace / 2}px)`, top: `calc(50% + ${(reserve - ZOOM_BAR_SPACE) / 2}px)`, width: W, height: H, transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale}) translate(${-W / 2}px, ${-H / 2}px)`, visibility: scale ? "visible" : "hidden" }}>
        <svg width={W} height={H} aria-hidden>
          {d.tasks.map((t) => {
            const p = spot(t.id);
            // Center to center. The opaque cards sit on top, so each line meets a card's nearest edge wherever it is dragged.
            return <line key={t.id} x1={-minX} y1={-minY} x2={p.x - minX} y2={p.y - minY} strokeWidth={1.5}
              stroke={t.status === "doing" ? "var(--accent)" : "var(--border)"} className={t.status === "doing" ? "flow" : undefined} />;
          })}
        </svg>
        <div className="node brain" style={at({ x: 0, y: 0 })}>
          <div className="eyebrow">Team project</div>
          <div className="title">{d.project.name}</div>
          {d.project.brief && <p className="brief">{d.project.brief}</p>}
          <div className="bars">
            <div className="bar">
              <span className="lbl"><BoardIcon name="decisions" />Tasks done</span>
              <div className="track"><div className="fill" style={{ width: `${d.tasks.length ? (done / d.tasks.length) * 100 : 0}%`, background: "var(--accent)" }} /></div>
              <span className="num">{done}/{d.tasks.length}</span>
            </div>
          </div>
          <div className="split"><span><BoardIcon name="lock" />{locked} agreed decision{locked === 1 ? "" : "s"}</span><span><BoardIcon name="due" />{dueLabel(d.project.due_date)}</span></div>
        </div>
        {d.tasks.map((t) => {
          const o = t.owner_member_id ? byId.get(t.owner_member_id) : undefined;
          const mine = o?.id === d.me.id;
          const online = o && Date.now() - Date.parse(o.last_seen_at) < 5 * 60_000;
          const logo = o ? aiLogo(o.ai_tool) : null;
          const due = taskDue(t.due_date, t.status);
          return (
            <div key={t.id} className={`node task-node ${mine ? "mine" : ""} ${t.status === "doing" ? "working" : ""} ${draggingId === t.id ? "dragging" : ""}`} style={at(spot(t.id))} {...handlers(t.id)}>
              <div className="task-node-top"><strong className={t.status === "done" ? "strike" : ""}>{t.title}</strong><Chip status={t.status} /></div>
              <div className="task-node-owner">
                {o ? <>
                  <span className="pair" title={`${o.name} with ${aiName(o.ai_tool)}`}>
                    <span className="avatar">{o.name[0]?.toUpperCase()}</span>
                    <span className="ai-badge">{logo ? <img src={logo} alt={o.ai_tool} /> : <BoardIcon name="ai" />}</span>
                  </span>
                  <span className="small">{mine ? "You" : o.name}{logo ? "" : ` · ${o.ai_tool}`}</span>
                  <Dot color={online ? "var(--ok)" : "var(--border)"} title={online ? "Active now" : `Seen ${timeAgo(o.last_seen_at)}`} />
                </> : <span className="small">Up for grabs</span>}
              </div>
              {due && <div className={`due ${due.tone}`} style={{ marginTop: 8 }}>{due.tone === "late" && <span aria-hidden>! </span>}{due.text}</div>}
              <div className="acts">
                {!o && <button className="btn sm" onClick={() => a.claim(t)}>Claim</button>}
                {mine && t.status !== "doing" && <button className="ghost sm" onClick={() => a.status(t, "doing")}>{t.status === "done" ? "Reopen" : "Start"}</button>}
                {mine && t.status !== "done" && <button className="ghost sm" onClick={() => a.status(t, "done")}>Done</button>}
              </div>
            </div>
          );
        })}
        {files.map((f) => (
          <div key={f.id} className={draggingId === f.id ? "dragging" : undefined} {...handlers(f.id)}>
            <FileCard file={f} slug={d.slug} className="node file-node" style={at(spot(f.id))}
              subtitle={d.tasks.find((task) => task.id === f.task_id)?.title ?? (f.kind === "link" ? "Project link" : "Project file")} openFile={openFile} />
          </div>
        ))}
      </div>
      <div className="zoom-bar" role="group" aria-label="Board zoom">
        <button type="button" aria-label="Zoom out" title="Zoom out" disabled={scale <= 0.25} onClick={() => zoomStep(-1)}><BoardIcon name="minus" /></button>
        <input type="range" min={25} max={200} step={5} value={Math.round(scale * 100)} aria-label="Zoom level" aria-valuetext={`${Math.round(scale * 100)} percent`} onChange={(e) => setZoom(Number(e.target.value) / 100)} />
        <button type="button" aria-label="Zoom in" title="Zoom in" disabled={scale >= 2} onClick={() => zoomStep(1)}><BoardIcon name="plus" /></button>
        <span className="zoom-pct" aria-live="polite">{Math.round(scale * 100)}%</span>
        <button type="button" aria-label="Fit board to window" title="Fit to window" onClick={fitBoard}><BoardIcon name="fit" /></button>
      </div>
    </div>
  );
}

// ---------- Tasks ----------
const STATUS_ICON: Record<Status, string> = { todo: "○", doing: "◐", done: "✓" };
const FILTERS: [Filter, string][] = [["all", "All"], ["mine", "Mine"], ["open", "Unclaimed"], ["doing", "In progress"]];

function TaskList(ctx: Ctx) {
  const { d, a, ui } = ctx;
  const [title, setTitle] = useState("");
  const test: Record<Filter, (t: Task) => boolean> = {
    all: () => true,
    mine: (t) => t.owner_member_id === d.me.id,
    open: (t) => !t.owner_member_id,
    doing: (t) => t.status === "doing",
  };
  const match = test[ui.filter];
  const shown = d.tasks.filter(match);
  const empty: Record<Filter, string> = {
    all: "No tasks yet. Add the first one below.",
    mine: "You don't have any tasks yet.",
    open: "Every task has an owner.",
    doing: "Nothing is in progress right now.",
  };
  return (
    <div className="tasks">
      <div className="seg filters" role="group" aria-label="Show tasks">
        {FILTERS.map(([k, label]) => (
          <button key={k} className={ui.filter === k ? "on" : ""} aria-pressed={ui.filter === k} onClick={() => ui.setFilter(k)}>
            {label} <span className="count">{d.tasks.filter(test[k]).length}</span>
          </button>
        ))}
      </div>
      {!shown.length && (
        <div className="empty">
          <p>{empty[ui.filter]}</p>
          {ui.filter === "mine" && d.tasks.some(test.open) && <button className="ghost sm" onClick={() => ui.setFilter("open")}>See unclaimed tasks</button>}
          {ui.filter !== "all" && ui.filter !== "mine" && <button className="ghost sm" onClick={() => ui.setFilter("all")}>Show all tasks</button>}
        </div>
      )}
      {shown.length > 0 && (
        <div className="sec">
          <div className="sec-t phase-t">
            <span>Tasks</span>
            <span className="num" aria-label={`${d.tasks.filter((t) => t.status === "done").length} of ${d.tasks.length} done`}>{d.tasks.filter((t) => t.status === "done").length}/{d.tasks.length}</span>
          </div>
          {shown.map((t) => <TaskCard key={t.id} {...ctx} t={t} />)}
        </div>
      )}
      <form className="row add-task" onSubmit={(e) => { e.preventDefault(); if (title.trim()) { a.addTask(title); setTitle(""); } }}>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="Add a task…" aria-label="New task" />
        <button className="ghost sm">Add</button>
      </form>
    </div>
  );
}

// One task. Collapsed: title, status, owner and the one action that matters now. Expanded: details and the rarer actions.
type Confirm = { kind: "unclaim" } | { kind: "hand"; to: MemberPublic };
function TaskCard({ d, byId, a, ui, t, openFile }: Ctx & { t: Task }) {
  const o = t.owner_member_id ? byId.get(t.owner_member_id) : undefined;
  const mine = !!o && o.id === d.me.id;
  const open = ui.open.has(t.id);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const act = async (label: string, p: () => Promise<Result>) => {
    setBusy(label); setErr(""); setConfirm(null);
    const r = await p();
    setBusy(null);
    if (r.error) setErr(r.error);
  };

  // Card actions are quiet: errors show on the card ("Aisha already has this"), successes still toast.
  const primary =
    !o ? { label: "Claim", doing: "Claiming…", run: () => a.claim(t, true) }
    : mine && t.status === "todo" ? { label: "Start", doing: "Starting…", run: () => a.status(t, "doing", true) }
    : mine && t.status === "doing" ? { label: "Mark done", doing: "Saving…", run: () => a.status(t, "done", true) }
    : null;
  const hand = (id: string) => {
    const to = d.members.find((m) => m.id === id);
    if (!to) return;
    // Taking work off a teammate needs a second click; handing off my own or an unclaimed task doesn't.
    if (o && !mine) setConfirm({ kind: "hand", to });
    else act("hand", () => a.reassign(t, to.id, true));
  };
  const detailsId = `task-more-${t.id}`;
  const due = taskDue(t.due_date, t.status);
  // Only notes and events saved with this task's id; older ones are never matched by their text.
  const note = d.latestNotes[t.id];
  const noteBy = note?.member_id ? byId.get(note.member_id) : undefined;
  const history = d.activity.filter((x) => x.task_id === t.id && x.kind !== "note").slice(0, 4);

  return (
    <div className={`task s-${t.status} ${mine ? "mine" : ""} ${open ? "open" : ""}`} aria-busy={!!busy}>
      <div className="t-head">
        <span className={`t-title ${t.status === "done" ? "strike" : ""}`} onClick={() => ui.toggle(t.id)}>{t.title}</span>
        {/* "To do" adds nothing next to Claim or Start; show the status when it says something. */}
        {!(t.status === "todo" && primary) && <span className={`chip ${t.status}`}><span aria-hidden>{STATUS_ICON[t.status]} </span>{STATUS_LABEL[t.status]}</span>}
      </div>
      <div className="t-meta">
        <span className="owner">
          {o ? <><Dot color={o.color} /><span className="who">{mine ? "You" : o.name}</span><span className="ai">· {o.ai_tool}</span></> : null}
        </span>
        {due && <span className={`due ${due.tone}`}>{due.tone === "late" && <span aria-hidden>! </span>}{due.text}</span>}
        {primary && (
          <button className="btn sm" disabled={!!busy} onClick={() => act(primary.label, primary.run)}>
            {busy === primary.label ? primary.doing : primary.label}
          </button>
        )}
        <button className="chev" aria-expanded={open} aria-controls={detailsId} onClick={() => ui.toggle(t.id)}
          aria-label={`${open ? "Hide" : "Show"} details for ${t.title}`} title={open ? "Hide details" : "More"}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>
      {err && <p className="t-err" role="alert">{err}</p>}

      {open && (
        <div id={detailsId} className="t-more">
          <dl className="t-facts">
            <div><dt>Owner</dt><dd>{o ? <>{mine ? "You" : o.name} <span className="small">· uses {o.ai_tool}</span></> : "Nobody yet"}</dd></div>
            {o && t.claimed_at && <div><dt>Claimed</dt><dd>{timeAgo(t.claimed_at)}</dd></div>}
            {t.done_at && <div><dt>Finished</dt><dd>{timeAgo(t.done_at)}</dd></div>}
            <div>
              <dt><label htmlFor={`due-${t.id}`}>Deadline</label></dt>
              <dd className="due-edit">
                <input id={`due-${t.id}`} type="date" className="date-in" value={t.due_date ?? ""} disabled={busy === "due"}
                  onChange={(e) => act("due", () => a.setDue(t, e.target.value || null, true))} />
                {t.due_date && <button className="linkbtn" disabled={!!busy} onClick={() => act("due", () => a.setDue(t, null, true))}>Clear</button>}
              </dd>
            </div>
          </dl>

          {note && (
            <figure className="t-note">
              <figcaption className="small">
                <Dot color={noteBy?.color ?? "var(--muted)"} />
                {noteBy ? `${noteBy.id === d.me.id ? "You" : noteBy.name} · ${noteBy.ai_tool}` : "Someone"} · {timeAgo(note.created_at)}
              </figcaption>
              <blockquote>“{note.text}”</blockquote>
            </figure>
          )}

          {history.length > 0 && (
            <div className="t-hist">
              <div className="small">Recent</div>
              <ul>{history.map((x) => <li key={x.id}><span>{x.message}</span><span className="small">{timeAgo(x.created_at)}</span></li>)}</ul>
            </div>
          )}

          {d.files.some((file) => file.task_id === t.id) && (
            <div className="t-files">
              {d.files.filter((file) => file.task_id === t.id).map((file) => (
                <button className="ghost sm" key={file.id} onClick={() => openFile(file.id)}>{file.kind === "link" ? "🔗" : "📎"} {file.name}</button>
              ))}
            </div>
          )}

          {o && !mine && <p className="t-info">{o.name} has this task. Check with them before jumping in, or hand it over below.</p>}

          {mine && t.status !== "done" && (
            <div className="t-ai">
              <button className="btn sm" onClick={() => ui.useAi(t)}>Use my AI</button>
              <span className="small">Get your AI working on this task, with the team's context.</span>
            </div>
          )}

          <div className="t-actions">
            {mine && t.status === "todo" && <button className="ghost sm" disabled={!!busy} onClick={() => act("done", () => a.status(t, "done", true))}>Mark done</button>}
            {mine && t.status === "done" && <button className="ghost sm" disabled={!!busy} onClick={() => act("reopen", () => a.status(t, "doing", true))}>{busy === "reopen" ? "Reopening…" : "Reopen"}</button>}
            {mine && t.status === "done" && <button className="ghost sm" onClick={() => ui.useAi(t)}>Use my AI</button>}
            <Dropdown compact label={`Hand ${t.title} to someone`} placeholder="Hand to…" onChange={hand}
              options={d.members.filter((m) => m.id !== t.owner_member_id).map((m) => ({ value: m.id, label: m.id === d.me.id ? "Me" : m.name }))} />
            {mine && <button className="linkbtn danger" disabled={!!busy} onClick={() => setConfirm({ kind: "unclaim" })}>Unclaim</button>}
          </div>

          {confirm && (
            <div className="t-confirm" role="group" aria-label="Confirm">
              <p>
                {confirm.kind === "unclaim"
                  ? `Unclaim “${t.title}”? It goes back to To do and anyone can take it.`
                  : confirm.to.id === d.me.id
                    ? `${o?.name} has this task. Take it over? ${o?.name} and the team will see it in What's new.`
                    : `${o?.name} has this task. Hand it to ${confirm.to.name}? ${o?.name} and the team will see it in What's new.`}
              </p>
              <div className="wrap-row">
                <button className="btn sm" autoFocus onClick={() => confirm.kind === "unclaim"
                  ? act("unclaim", () => a.unclaim(t, true))
                  : act("hand", () => a.reassign(t, confirm.to.id, true))}>
                  {confirm.kind === "unclaim" ? "Unclaim" : confirm.to.id === d.me.id ? "Take it over" : `Hand to ${confirm.to.name}`}
                </button>
                <button className="ghost sm" onClick={() => setConfirm(null)}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- Your AI: link and paste back ----------
// What a member gives their AI so it knows which task is theirs right now.
// The header matches the agent page; the parser also still accepts GROUPMIND UPDATE.
function taskPrompt(d: AppData, t: Task) {
  return [
    `Let's work on my task "${t.title}" for our group project "${d.project.name}".`,
    "Use the project context. Follow the decisions the team agreed on, and don't redo teammates' tasks.",
    "Help me get this task done. When I start it, make real progress, or finish it, end your reply with:",
    "",
    "IGLOO UPDATE",
    `task: ${t.title}`,
    "status: doing",
    "note: one short line about what changed",
    "",
    "Use status: done when the task is finished. Copy the task title exactly.",
  ].join("\n");
}
// A short project summary from what this page already shows: no tokens and no teammates' notes.
// Used by "Copy task for my AI", and when the full context from the agent link can't be loaded.
function shortContext(d: AppData) {
  const name = (id: string | null) => (id === d.me.id ? "me" : d.members.find((m) => m.id === id)?.name ?? "someone");
  const locked = d.decisions.filter((x) => x.approved_by);
  const others = d.tasks.filter((t) => t.owner_member_id && t.owner_member_id !== d.me.id);
  return [
    `Group project: ${d.project.name}${d.project.course_or_context ? ` (${d.project.course_or_context})` : ""}`,
    `Due: ${d.project.due_date ? `${d.project.due_date} (${dueLabel(d.project.due_date)})` : "no due date"}`,
    `I'm ${d.me.name}. Each teammate works with their own AI.`, "",
    "Brief:", d.project.brief || "(no brief)", "",
    "Decisions the team agreed on (follow them):", ...(locked.length ? locked.map((x) => `- ${x.text}`) : ["- None yet"]), "",
    "Teammates' tasks (don't redo these):", ...(others.length ? others.map((t) => `- ${name(t.owner_member_id)}: ${t.title} [${t.status}]`) : ["- None yet"]),
  ].join("\n");
}

function AiPanel({ d, a, toast, task, clearTask }: {
  d: AppData; a: Actions; toast: (t: string, tone?: Toast["tone"]) => void; task: Task | null; clearTask: () => void;
}) {
  const focusRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Coming from "Use my AI": bring the task into view (the panel sits below the board on phones).
    if (task && focusRef.current) { focusRef.current.scrollIntoView({ block: "nearest" }); focusRef.current.focus({ preventScroll: true }); }
  }, [task?.id]); // only when the focused task changes, not on every live refresh
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
    const res = await fetch(`/a/${d.me.agent_token}`).catch(() => null);
    const type = res?.headers.get("content-type") ?? "";
    // Never paste an error page into someone's AI. If the full context can't load, copy the short version instead.
    if (!res?.ok || !type.startsWith("text/plain")) {
      if (task) return copyTask();
      return toast("Couldn't load your AI's context right now. Try again in a moment.", "bad");
    }
    const body = await res.text();
    await copy(`Here is my group project context from Igloo. Help me with my tasks and report progress in the format at the end.\n\n${body}${task ? `\n\n${taskPrompt(d, task)}` : ""}`)
      .then(() => toast(task ? `Copied, with “${task.title}” at the end. Paste it into your AI chat.` : "Copied. Paste it into your AI chat.", "ok"))
      .catch(() => toast(COPY_FAILED, "bad"));
  };
  // Works on its own: the short project summary plus the task, so the AI can start right away.
  const copyTask = () => task && copy(`${shortContext(d)}\n\n${taskPrompt(d, task)}`)
    .then(() => toast(`Copied “${task.title}” with the project summary. Paste it into your AI chat.`, "ok"))
    .catch(() => toast(COPY_FAILED, "bad"));
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
      {task && (
        <div ref={focusRef} tabIndex={-1} className="ai-task" aria-label={`Working on ${task.title}`}>
          <div className="ai-task-head">
            <div>
              <div className="eyebrow">Working on</div>
              <div className="ai-task-title">{task.title}</div>
            </div>
            <button className="linkbtn" onClick={clearTask} aria-label="Stop focusing on this task">Clear</button>
          </div>
          <button className="btn" style={{ width: "100%", marginTop: 10 }} onClick={copyTask}>Copy task for my AI</button>
          <ol className="steps">
            <li>Paste it into your AI chat. It has the brief, the agreed decisions, teammates' tasks and this task.</li>
            <li>Want the full picture? <b>Copy as text</b> below adds this task at the end. Coding agents can use <b>Copy link</b>.</li>
            <li>When your AI replies with an IGLOO UPDATE block, paste it in step 2.</li>
          </ol>
        </div>
      )}
      <div className="sec">
        <div className="sec-t">1. Tell your AI about the project</div>
        <p className="small" style={{ margin: "0 0 12px" }}>Your private link tells your AI the brief, your tasks, who is doing what, and what the team agreed.</p>
        <div className="private"><BoardIcon name="lock" />Private link for {d.me.name}</div>
        <div className="wrap-row">
          {/* With a task in focus, "Copy task for my AI" is the main button; don't compete with it. */}
          <button className={task ? "ghost" : "btn"} onClick={a.copyAgent}>Copy link</button>
          <button className="ghost" onClick={copyText}>Copy as text</button>
          <a className="ghost" href={`/a/${d.me.agent_token}`} target="_blank" rel="noreferrer">Preview</a>
        </div>
        <p className="help"><b>ChatGPT, Claude or Gemini app?</b> Use Copy as text and paste it in.<br /><b>Claude Code, Codex or Cursor?</b> Give it the link. It can post updates by itself.</p>
        <button className="linkbtn" style={{ fontSize: 11, textDecoration: "underline" }}
          onClick={() => copy(`claude mcp add --transport http igloo "${location.origin}/api/mcp?token=${d.me.agent_token}"`).then(() => toast("Copied. Run it where you use Claude Code.", "ok"), () => toast(COPY_FAILED, "bad"))}>
          Advanced: connect Claude directly (MCP)
        </button>
      </div>
      <div className="sec">
        <div className="sec-t">2. Paste what your AI said back</div>
        <textarea className="input" rows={6} value={text} onChange={(e) => setText(e.target.value)} aria-label="Your AI's reply"
          placeholder={`IGLOO UPDATE\ntask: ${task?.title ?? "Pitch deck"}\nstatus: doing\nnote: ${task ? "one short line about what changed" : "outline drafted, 8 slides"}`} />
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
            <div><BoardIcon name="lock" />{x.text}</div>
            <div className="small" style={{ marginTop: 4 }}>{cap(who(x.created_by))} suggested · {who(x.approved_by)} agreed</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- Quick actions (N or Cmd K) ----------
function Palette({ d, a, close, setView, setTab, panel, showPanel }: Ctx & {
  close: () => void; setView: (v: "board" | "list") => void; setTab: (t: Tab) => void; panel: boolean; showPanel: (v: boolean) => void;
}) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const cmds = useMemo(() => {
    const list: { label: string; hint?: string; run: () => void }[] = [];
    for (const t of d.tasks) {
      if (!t.owner_member_id) list.push({ label: `Claim: ${t.title}`, hint: "task", run: () => a.claim(t) });
      if (t.owner_member_id === d.me.id && t.status === "todo") list.push({ label: `Start: ${t.title}`, hint: "mine", run: () => a.status(t, "doing") });
      if (t.owner_member_id === d.me.id && t.status !== "done") list.push({ label: `Mark done: ${t.title}`, hint: "mine", run: () => a.status(t, "done") });
    }
    for (const x of d.decisions) if (!x.approved_by && x.created_by !== d.me.id) list.push({ label: `Agree: ${x.text}`, hint: "decision", run: () => a.approve(x.id) });
    list.push(
      { label: "Copy link for my AI", run: a.copyAgent },
      { label: "Copy summary for group chat", run: a.copyDigest },
      { label: "Copy invite", run: a.copyInvite },
      { label: "Add a file or link", run: () => setTab("files") },
      { label: "Show board", run: () => setView("board") },
      { label: "Show list", run: () => setView("list") },
      { label: "Paste what my AI said", run: () => setTab("ai") },
      { label: panel ? "Hide side panel" : "Show side panel", run: () => showPanel(!panel) },
      { label: "See what's new", run: () => setTab("activity") },
      { label: "Open decisions", run: () => setTab("decisions") },
    );
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const hits = list.filter((c) => words.every((w) => c.label.toLowerCase().includes(w)));
    if (q.trim()) hits.push(
      { label: `Add task: ${q.trim()}`, hint: "task", run: () => a.addTask(q) },
      { label: `Suggest decision: ${q.trim()}`, run: () => a.propose(q) },
    );
    return hits.slice(0, 12);
  }, [q, d, a, setView, setTab, panel, showPanel]);
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

// ---------- Files and links ----------
function FileCard({ file, slug, className, style, subtitle, openFile, onDelete }: {
  file: ProjectFile; slug: string; className: string; style?: CSSProperties; subtitle: string; openFile: (id: string) => void;
  onDelete?: () => void;
}) {
  return <div className={`file-card ${className}`} style={style}>
    <FileThumbnail key={file.id} file={file} slug={slug} />
    <button className="file-open" type="button" onClick={() => openFile(file.id)}>
      <strong>{file.name}</strong><span className="small">{FILE_LABEL[file.kind]} · {subtitle}</span>
    </button>
    {onDelete && <button className="file-delete" type="button" aria-label={`Delete ${file.name}`} title="Delete" onClick={onDelete}>×</button>}
  </div>;
}

function FilesPanel({ d, byId, selected, openFile, back, remove }: {
  d: AppData; byId: Map<string, MemberPublic>; selected: string | null; openFile: (id: string) => void; back: () => void;
  remove: (file: ProjectFile, after?: () => void) => void;
}) {
  const [state, action, pending] = useActionState(A.shareFile, {});
  const [linkedTask, setLinkedTask] = useState("");
  const file = d.files.find((entry) => entry.id === selected);
  const titleOf = (entry: ProjectFile) => d.tasks.find((task) => task.id === entry.task_id)?.title ?? "Project file";
  if (file) return (
    <section className="sec">
      <button className="linkbtn" onClick={back}>← All files</button>
      <div className="file-detail">
        <div className="eyebrow">{file.kind === "link" && file.url ? `${linkService(file.url)} link` : FILE_LABEL[file.kind]} · {titleOf(file)}</div>
        <h2 className="title">{file.name}</h2>
        <div className="small">Shared by {byId.get(file.member_id)?.name ?? "A teammate"}{file.kind === "link" ? "" : ` · ${Math.max(1, Math.round(file.size / 1024))} KB`}</div>
        <FileThumbnail key={file.id} file={file} slug={d.slug} />
        {file.kind === "link" && file.url && <p className="small link-url">{file.url}</p>}
        <div className="wrap-row file-actions">
          {file.kind === "link" && file.url
            ? <a className="btn" href={file.url} target="_blank" rel="noopener noreferrer">Open link</a>
            : <a className="btn" href={fileUrl(file.id, d.slug)}>Download</a>}
          {file.kind === "pdf" && <a className="ghost" href={fileUrl(file.id, d.slug) + "&preview=1"} target="_blank" rel="noreferrer">Open PDF</a>}
          <button className="ghost danger" type="button" onClick={() => remove(file, back)}>Delete</button>
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
      <LinkForm d={d} />
      {d.files.slice().reverse().map((entry) => (
        <FileCard key={entry.id} file={entry} slug={d.slug} className="task file-row"
          subtitle={`${titleOf(entry)} · ${byId.get(entry.member_id)?.name ?? "A teammate"}`} openFile={openFile}
          onDelete={() => remove(entry)} />
      ))}
    </section>
  );
}

// GitHub repos and PRs, Canva designs, Figma files and other links live next to files.
function LinkForm({ d }: { d: AppData }) {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [task, setTask] = useState("");
  const [msg, setMsg] = useState<Result>({});
  const [pending, start] = useTransition();
  const valid = !!cleanUrl(url);
  return (
    <form className="file-form link-form" onSubmit={(e) => {
      e.preventDefault();
      if (!valid) { setMsg({ error: "Paste a full link that starts with https://" }); return; }
      start(async () => {
        const r = await A.addLink(d.slug, url, name, task);
        setMsg(r);
        if (r.ok) { setUrl(""); setName(""); setTask(""); }
      });
    }}>
      <label className="label">Add a link
        <input className="input" type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} maxLength={500}
          placeholder="https://github.com/team/repo or a Canva link" />
      </label>
      <label className="label">Name <span className="optional">(optional)</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={160}
          placeholder={valid ? linkService(cleanUrl(url)!) : "Pitch deck in Canva"} />
      </label>
      <div>
        <span className="label">Link to a task</span>
        <Dropdown label="Link to a task" placeholder="Project link (no task)" value={task} onChange={setTask}
          options={[{ value: "", label: "Project link (no task)" }, ...d.tasks.map((t) => ({ value: t.id, label: t.title }))]} />
      </div>
      {msg.error && <p className="err" role="alert">{msg.error}</p>}
      {msg.ok && <p className="small" role="status">{msg.ok}</p>}
      <button className="btn" disabled={pending || !url.trim()}>{pending ? "Sharing…" : "Share link"}</button>
    </form>
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

