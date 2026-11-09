"use client";
// The whole group page, laid out like docs/group-page-sample.html.
import { useActionState, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import * as A from "@/app/actions";
import {
  AI_TOOLS, PHASES, buildDigest, daysLeft, dueLabel, fairness, matchTask, parseUpdates, taskDue, timeAgo,
  type Activity, type Decision, type MemberPublic, type Phase, type Result, type Status, type Task, type TaskNote,
} from "@/lib/core";

const STATUS_LABEL: Record<Status, string> = { todo: "To do", doing: "In progress", done: "Done" };
const PHASE_LABEL: Record<Phase, string> = { research: "🔎 Research", build: "🛠️ Build", present: "🎤 Present" };
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
  latestNotes: Record<string, TaskNote>;
};
type Tab = "tasks" | "ai" | "activity" | "decisions";
type Toast = { id: number; text: string; tone: "ok" | "bad" | "info" };
type Actions = ReturnType<typeof useActions>;
type Filter = "all" | "mine" | "open" | "doing";
// Task panel state lives in App, so the filter and open cards survive switching tabs and views.
type TaskUi = { filter: Filter; setFilter: (f: Filter) => void; open: Set<string>; toggle: (id: string) => void; useAi: (t: Task) => void };
type Ctx = { d: AppData; byId: Map<string, MemberPublic>; a: Actions; ui: TaskUi };

function useActions(d: AppData, toast: (t: string, tone?: Toast["tone"]) => void) {
  const [, start] = useTransition();
  // Resolves with the result, so a card can show its own busy state and error.
  // quiet: the caller shows the error itself (a task card does, inline), so skip the error toast.
  const run = (p: Promise<Result>, okText?: string, quiet = false) => new Promise<Result>((resolve) => start(async () => {
    const r: Result = await p.catch(() => ({ error: "Couldn't reach Igloo. Check your connection and try again." }));
    if (r.error) { if (!quiet) toast(r.error, "bad"); }
    else if (r.ok && r.ok !== "No change") toast(okText ?? r.ok, "ok");
    resolve(r);
  }));
  const groupUrl = () => `${location.origin}/p/${d.slug}`;
  const statusText = (t: Task, s: Status) =>
    s === "done" ? `Marked “${t.title}” done` : s === "doing" ? (t.status === "done" ? `Reopened “${t.title}”` : `Started “${t.title}”`) : undefined;
  const nameOf = (id: string) => (id === d.me.id ? "you" : d.members.find((m) => m.id === id)?.name ?? "them");
  return {
    claim: (t: Task, quiet?: boolean) => run(A.claim(d.slug, t.id), `You claimed “${t.title}”`, quiet),
    status: (t: Task, s: Status, quiet?: boolean) => run(A.setStatus(d.slug, t.id, s), statusText(t, s), quiet),
    unclaim: (t: Task, quiet?: boolean) => run(A.unclaim(d.slug, t.id), `Unclaimed “${t.title}”. It's up for grabs again.`, quiet),
    reassign: (t: Task, m: string, quiet?: boolean) => run(A.reassign(d.slug, t.id, m), `Handed “${t.title}” to ${nameOf(m)}`, quiet),
    setDue: (t: Task, due: string | null, quiet?: boolean) => run(A.setDue(d.slug, t.id, due), due ? `Deadline for “${t.title}” set to ${taskDue(due, "done")?.text.replace(/^Due /, "")}` : `Cleared the deadline on “${t.title}”`, quiet),
    addTask: (title: string, p: Phase) => run(A.addTask(d.slug, title, p)),
    propose: (text: string) => run(A.proposeDecision(d.slug, text)),
    approve: (id: string) => run(A.approveDecision(d.slug, id)),
    copyDigest: () => copy(buildDigest(d.project, d.members, d.tasks, groupUrl())).then(() => toast("Update copied. Paste it in your group chat.", "ok"), () => toast(COPY_FAILED, "bad")),
    copyAgent: () => copy(`${location.origin}/a/${d.me.agent_token}`).then(() => toast("Link copied. Paste it into your AI, and keep it private.", "ok"), () => toast(COPY_FAILED, "bad")),
    copyInvite: () => copy(`Join ${d.project.name} on Igloo\n${groupUrl()}\nCode: ${d.project.join_code}`).then(() => toast("Invite copied", "ok"), () => toast(COPY_FAILED, "bad")),
  };
}

export function App(d: AppData) {
  const router = useRouter();
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
  const a = useActions(d, toast);

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

  const ctx = { d, byId, a, ui };
  const done = d.tasks.filter((t) => t.status === "done").length;
  const waiting = d.decisions.some((x) => !x.approved_by);

  return (
    <div className="app">
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
            <form action={A.leaveDevice}>
              <input type="hidden" name="slug" value={d.slug} />
              <button className="linkbtn" title="Not you? Switch person on this device">Switch</button>
            </form>
          </div>
        </div>
      </header>

      <div className={`body ${panel ? "panel-open" : "panel-hidden"}`}>
        <main>
          {!panel && (
            <button className="panel-show" onClick={() => showPanel(true)} aria-controls="side-panel" aria-expanded={false}>
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><path d="M7.5 3 4.5 6l3 3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
              Tasks and team
            </button>
          )}
          {view === "board" ? <Board d={d} reserve={wide && panel ? PANEL_SPACE : 0} /> : (
            <div className="list dots">
              <div className="stack">
                <div className="card"><Fairness members={d.members} tasks={d.tasks} /></div>
                <div className="card"><TaskList {...ctx} /></div>
              </div>
            </div>
          )}
        </main>
        <aside id="side-panel">
          <nav>
            <div role="tablist" className="tabs">
              {([["tasks", "Tasks"], ["ai", "Your AI"], ["activity", "What's new"], ["decisions", "Decisions"]] as const).map(([k, label]) => (
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
// reserve: width on the right covered by the floating side panel; the board fits and centres in the rest.
function Board({ d, reserve = 0 }: { d: AppData; reserve?: number }) {
  const n = d.members.length, grow = Math.max(1, n / 6);
  const rx = 425 * grow, ry = 320 * grow, W = 2 * rx + 250, H = 2 * ry + 150, cx = W / 2, cy = H / 2;
  const nodes = d.members.map((m, i) => {
    const ang = (i / Math.max(n, 1)) * Math.PI * 2 - Math.PI / 2;
    const mine = d.tasks.filter((t) => t.owner_member_id === m.id);
    const task = mine.find((t) => t.status === "doing") ?? mine.find((t) => t.status === "todo") ?? mine.findLast((t) => t.status === "done");
    return { m, x: cx + Math.cos(ang) * rx, y: cy + Math.sin(ang) * ry, task, mine, active: mine.some((t) => t.status === "doing") };
  });
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setScale(Math.min(Math.max(el.clientWidth - reserve, 200) / (W + 40), el.clientHeight / (H + 40), 1));
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    fit();
    return () => ro.disconnect();
  }, [W, H, reserve]);
  const locked = d.decisions.filter((x) => x.approved_by).length;

  return (
    <div ref={box} className="board dots">
      <div className="stage" style={{ left: `calc(50% - ${reserve / 2}px)`, width: W, height: H, transform: `scale(${scale}) translate(${-cx}px, ${-cy}px)`, visibility: scale ? "visible" : "hidden" }}>
        <svg width={W} height={H} aria-hidden>
          {nodes.map((p) => <line key={p.m.id} x1={cx} y1={cy} x2={p.x} y2={p.y} strokeWidth={1.5} stroke={p.active ? p.m.color : "#ebe4d8"} className={p.active ? "flow" : undefined} />)}
        </svg>
        <div className="node brain" style={{ left: cx, top: cy }}>
          <div className="title">{d.project.name}</div>
          {d.project.brief && <p className="brief">{d.project.brief}</p>}
          <div className="bars">
            {PHASES.map((ph) => {
              const ts = d.tasks.filter((t) => t.phase === ph), dn = ts.filter((t) => t.status === "done").length;
              return (
                <div key={ph} className="bar">
                  <span className="lbl">{PHASE_LABEL[ph]}</span>
                  <div className="track"><div className="fill" style={{ width: `${ts.length ? (dn / ts.length) * 100 : 0}%`, background: "var(--accent)" }} /></div>
                  <span className="num">{dn}/{ts.length}</span>
                </div>
              );
            })}
          </div>
          <div className="split"><span>🤝 {locked} agreed decision{locked === 1 ? "" : "s"}</span><span>📅 {dueLabel(d.project.due_date)}</span></div>
          <div className="divider"><Fairness members={d.members} tasks={d.tasks} /></div>
        </div>
        {nodes.map(({ m, x, y, task, mine }) => {
          const online = Date.now() - Date.parse(m.last_seen_at) < 5 * 60_000;
          const dn = mine.filter((t) => t.status === "done").length;
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
              <div className="now">{task ? <><span>{task.title}</span><Chip status={task.status} /></> : <span className="small">No active tasks</span>}</div>
              {mine.length > 0 && <div className="small" style={{ marginTop: 8 }}>{dn} of {mine.length} task{mine.length === 1 ? "" : "s"} done</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Fairness ----------
function Fairness({ members, tasks }: { members: MemberPublic[]; tasks: Task[] }) {
  const f = fairness(members, tasks);
  const pct = Math.round(f.fair * 100);
  return (
    <div>
      <div className="fair-head"><span style={{ fontWeight: 600 }}>Contribution</span><span className="small">{f.total ? `fair share is ${pct}% each` : "nothing finished yet"}</span></div>
      {f.rows.map((r) => (
        <div key={r.member.id} className="fair-row">
          <span className="name">{r.member.name}</span>
          <div className="track"><div className="fill" style={{ width: `${r.share * 100}%`, background: r.member.color }} /><div className="mark" style={{ left: `${pct}%` }} title="Fair share" /></div>
          <span className="num">{Math.round(r.share * 100)}%</span>
        </div>
      ))}
    </div>
  );
}

// ---------- Tasks ----------
const STATUS_ICON: Record<Status, string> = { todo: "○", doing: "◐", done: "✓" };
const FILTERS: [Filter, string][] = [["all", "All"], ["mine", "Mine"], ["open", "Unclaimed"], ["doing", "In progress"]];

function TaskList(ctx: Ctx) {
  const { d, a, ui } = ctx;
  const [title, setTitle] = useState("");
  const [phase, setPhase] = useState<Phase>("build");
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
      {d.tasks.length > 0 && PHASES.map((ph) => {
        const all = d.tasks.filter((t) => t.phase === ph);
        const ts = all.filter(match);
        if (ui.filter !== "all" && !ts.length) return null;
        return (
          <div key={ph} className="sec">
            <div className="sec-t phase-t">
              <span>{PHASE_LABEL[ph]}</span>
              <span className="num" aria-label={`${all.filter((t) => t.status === "done").length} of ${all.length} done`}>{all.filter((t) => t.status === "done").length}/{all.length}</span>
            </div>
            {!ts.length && <div className="small">Nothing here yet</div>}
            {ts.map((t) => <TaskCard key={t.id} {...ctx} t={t} />)}
          </div>
        );
      })}
      <form className="row add-task" onSubmit={(e) => { e.preventDefault(); if (title.trim()) { a.addTask(title, phase); setTitle(""); } }}>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="Add a task…" aria-label="New task" />
        <select className="hand" style={{ borderRadius: 12 }} value={phase} onChange={(e) => setPhase(e.target.value as Phase)} aria-label="Phase">
          {PHASES.map((p) => <option key={p} value={p}>{PHASE_LABEL[p]}</option>)}
        </select>
        <button className="ghost sm">Add</button>
      </form>
    </div>
  );
}

// One task. Collapsed: title, status, owner and the one action that matters now. Expanded: details and the rarer actions.
type Confirm = { kind: "unclaim" } | { kind: "hand"; to: MemberPublic };
function TaskCard({ d, byId, a, ui, t }: Ctx & { t: Task }) {
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
            <div><dt>Phase</dt><dd>{PHASE_LABEL[t.phase]}</dd></div>
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
            <select className="hand" value="" disabled={!!busy} aria-label={`Hand ${t.title} to someone`} onChange={(e) => hand(e.target.value)}>
              <option value="">Hand to…</option>
              {d.members.filter((m) => m.id !== t.owner_member_id).map((m) => <option key={m.id} value={m.id}>{m.id === d.me.id ? "Me" : m.name}</option>)}
            </select>
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
    `Let's work on my task "${t.title}" (${t.phase} phase) for our group project "${d.project.name}".`,
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
        <div className="private">🔒 Private link for {d.me.name}</div>
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
            <div>🔒 {x.text}</div>
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
      if (!t.owner_member_id) list.push({ label: `Claim: ${t.title}`, hint: t.phase, run: () => a.claim(t) });
      if (t.owner_member_id === d.me.id && t.status === "todo") list.push({ label: `Start: ${t.title}`, hint: "mine", run: () => a.status(t, "doing") });
      if (t.owner_member_id === d.me.id && t.status !== "done") list.push({ label: `Mark done: ${t.title}`, hint: "mine", run: () => a.status(t, "done") });
    }
    for (const x of d.decisions) if (!x.approved_by && x.created_by !== d.me.id) list.push({ label: `Agree: ${x.text}`, hint: "decision", run: () => a.approve(x.id) });
    list.push(
      { label: "Copy link for my AI", run: a.copyAgent },
      { label: "Copy summary for group chat", run: a.copyDigest },
      { label: "Copy invite", run: a.copyInvite },
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
      { label: `Add task: ${q.trim()}`, hint: "build", run: () => a.addTask(q, "build") },
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
