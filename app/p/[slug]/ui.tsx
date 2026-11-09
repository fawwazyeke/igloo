"use client";
// The whole group page, laid out like docs/group-page-sample.html.
import { useActionState, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import * as A from "@/app/actions";
import { Aurora } from "@/components/ui/aurora";
import {
  AI_TOOLS, PHASES, buildDigest, dueLabel, fairness, matchTask, parseUpdates, timeAgo,
  type Activity, type Decision, type MemberPublic, type Phase, type Result, type Status, type Task,
} from "@/lib/core";

const STATUS_LABEL: Record<Status, string> = { todo: "To do", doing: "In progress", done: "Done" };
const PHASE_LABEL: Record<Phase, string> = { research: "🔎 Research", build: "🛠️ Build", present: "🎤 Present" };
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
  // Controlled so a wrong code doesn't wipe them: React resets uncontrolled fields after a form action.
  const [memberName, setMemberName] = useState("");
  const [otherTool, setOtherTool] = useState("");
  const [joinCode, setJoinCode] = useState(code ?? "");
  return (
    <main className="page landing">
      <Aurora className="canvas-aurora" />
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
};
type Tab = "tasks" | "ai" | "activity" | "decisions";
type Toast = { id: number; text: string; tone: "ok" | "bad" | "info" };
type Actions = ReturnType<typeof useActions>;
type Ctx = { d: AppData; byId: Map<string, MemberPublic>; a: Actions };

function useActions(d: AppData, toast: (t: string, tone?: Toast["tone"]) => void) {
  const [, start] = useTransition();
  const run = (p: Promise<Result>) => start(async () => { const r = await p; if (r.error) toast(r.error, "bad"); else if (r.ok) toast(r.ok, "ok"); });
  const groupUrl = () => `${location.origin}/p/${d.slug}`;
  return {
    claim: (t: Task) => run(A.claim(d.slug, t.id)),
    status: (t: Task, s: Status) => run(A.setStatus(d.slug, t.id, s)),
    unclaim: (t: Task) => run(A.unclaim(d.slug, t.id)),
    reassign: (t: Task, m: string) => run(A.reassign(d.slug, t.id, m)),
    addTask: (title: string, p: Phase) => run(A.addTask(d.slug, title, p)),
    propose: (text: string) => run(A.proposeDecision(d.slug, text)),
    approve: (id: string) => run(A.approveDecision(d.slug, id)),
    copyDigest: () => copy(buildDigest(d.project, d.members, d.tasks, groupUrl())).then(() => toast("Update copied. Paste it in your group chat.", "ok")),
    copyAgent: () => copy(`${location.origin}/a/${d.me.agent_token}`).then(() => toast("Link copied. Paste it into your AI, and keep it private.", "ok")),
    copyInvite: () => copy(`Join ${d.project.name} on Igloo\n${groupUrl()}\nCode: ${d.project.join_code}`).then(() => toast("Invite copied", "ok")),
  };
}

export function App(d: AppData) {
  const router = useRouter();
  const [view, setView] = useState<"board" | "list">("board");
  const [tab, setTab] = useState<Tab>("tasks");
  const [palette, setPalette] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const byId = useMemo(() => new Map(d.members.map((m) => [m.id, m])), [d.members]);

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

  const ctx = { d, byId, a };
  const done = d.tasks.filter((t) => t.status === "done").length;
  const waiting = d.decisions.some((x) => !x.approved_by);

  return (
    <div className="app">
      <header>
        <div>
          <div className="ctx">{[d.project.course_or_context, d.project.due_date && dueLabel(d.project.due_date)].filter(Boolean).join(" · ") || "Igloo"}</div>
          <div className="title">{d.project.name}</div>
        </div>
        <span className="pill">{done} of {d.tasks.length} done</span>
        <div className="hright">
          <div className="seg" role="group" aria-label="View">
            {(["board", "list"] as const).map((v) => <button key={v} className={view === v ? "on" : ""} aria-pressed={view === v} onClick={() => setView(v)}>{v === "board" ? "Board" : "List"}</button>)}
          </div>
          <button className="ghost" onClick={a.copyInvite}>Invite</button>
          <button className="btn" onClick={a.copyDigest}>Copy update for group chat</button>
          <button className="ghost" style={{ color: "var(--muted)" }} onClick={() => setPalette(true)} title="Quick actions (N or ⌘K)">Quick actions</button>
          <div className="me">
            <Dot color={d.me.color} />{d.me.name}
            <form action={A.leaveDevice}>
              <input type="hidden" name="slug" value={d.slug} />
              <button className="linkbtn" title="Not you? Switch person on this device">Switch</button>
            </form>
          </div>
        </div>
      </header>

      <div className="body">
        <main>
          <Aurora className="canvas-aurora" colors={["#25B5A9", "#A0FF77", "#25B5A9", "#A0FF77", "#25B5A9"]} />
          {view === "board" ? <Board {...ctx} /> : (
            <div className="list dots">
              <div className="stack">
                <div className="card"><Fairness members={d.members} tasks={d.tasks} /></div>
                <div className="card"><TaskList {...ctx} plain /></div>
              </div>
            </div>
          )}
        </main>
        <aside>
          <nav role="tablist">
            {([["tasks", "Tasks"], ["ai", "Your AI"], ["activity", "What's new"], ["decisions", "Decisions"]] as const).map(([k, label]) => (
              <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
                {label}{k === "decisions" && waiting && <span className="badge" aria-label="waiting for a yes">•</span>}
              </button>
            ))}
          </nav>
          <div className="pane">
            {tab === "tasks" && <TaskList {...ctx} />}
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
const BOARD_PHASE_LABEL: Record<Phase, string> = { research: "Research", build: "Build", present: "Present" };

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
  const tasks = PHASES.flatMap((ph) => d.tasks.filter((t) => t.phase === ph));
  const mine = tasks.filter((t) => t.owner_member_id === d.me.id);
  const doing = mine.find((t) => t.status === "doing");
  if (doing) return { label: "You're on", task: doing, action: "Mark done", run: () => a.status(doing, "done") };
  const todo = mine.find((t) => t.status === "todo");
  if (todo) return { label: "Your next", task: todo, action: "Start", run: () => a.status(todo, "doing") };
  const open = tasks.find((t) => !t.owner_member_id && t.status === "todo");
  if (open) return { label: "Up next", task: open, action: "Claim", run: () => a.claim(open) };
  return null;
}

// A member's latest activity, without their own name at the start of the message.
function lastUpdate(d: AppData, m: MemberPublic) {
  const latest = d.activity.filter((x) => x.member_id === m.id).reduce<Activity | undefined>((best, x) => (!best || x.created_at > best.created_at ? x : best), undefined);
  if (!latest) return null;
  const text = latest.message.startsWith(`${m.name}: `) ? latest.message.slice(m.name.length + 2) : latest.message.startsWith(`${m.name} `) ? latest.message.slice(m.name.length + 1) : latest.message;
  return { text: text.charAt(0).toUpperCase() + text.slice(1), at: latest.created_at };
}

const clampZoom = (v: number) => Math.min(2, Math.max(0.25, v));
const ZOOM_BAR_SPACE = 60; // Height kept clear at the bottom so cards fit above the zoom bar.

function Board({ d, a }: Ctx) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 30_000); return () => clearInterval(t); }, []);
  const next = nextStep(d, a);
  const reserve = next ? 64 : 0; // Height kept clear for the next-step bar.
  const n = d.members.length, grow = Math.max(1, n / 6);
  const [brainH, setBrainH] = useState(0);
  const rx = 425 * grow, ry = Math.max(320 * grow, brainH / 2 + 150), W =2 * rx + 250, H = 2 * ry + 150, cx = W / 2, cy = H / 2;
  const nodes = d.members.map((m, i) => {
    const ang = (i / Math.max(n, 1)) * Math.PI * 2 - Math.PI / 2;
    const mine = d.tasks.filter((t) => t.owner_member_id === m.id);
    const task = mine.find((t) => t.status === "doing") ?? mine.find((t) => t.status === "todo") ?? mine.findLast((t) => t.status === "done");
    return { m, x: cx + Math.cos(ang) * rx, y: cy + Math.sin(ang) * ry, task, mine, active: mine.some((t) => t.status === "doing") };
  });
  const box = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState({ scale: 0, x: cx, y: cy });
  // zoom is null while the board auto-fits; a number once someone takes control.
  const [zoom, setZoom] = useState<number | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const scale = zoom ?? frame.scale;
  const zoomStep = (dir: number) => setZoom(clampZoom((Math.round(scale * 10) + dir) / 10));
  const fitBoard = () => { setZoom(null); setPan({ x: 0, y: 0 }); };
  const startPan = (e: React.PointerEvent<HTMLDivElement>) => {
    if (zoom === null || (e.target as HTMLElement).closest(".node, .next-step, .zoom-bar")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
    setDragging(true);
  };
  const movePan = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const { clientWidth: w, clientHeight: h } = e.currentTarget;
    setPan({ x: Math.max(-w, Math.min(w, e.clientX - drag.current.x)), y: Math.max(-h, Math.min(h, e.clientY - drag.current.y)) });
  };
  const endPan = () => { drag.current = null; setDragging(false); };
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const cards = Array.from(el.querySelectorAll<HTMLElement>(".node"));
    // Frame the cards that exist. offset* ignores the stage's scale, and each card is centred on its left/top.
    const fit = () => {
      if (!cards.length) return;
      setBrainH(cards.find((c) => c.classList.contains("brain"))?.offsetHeight ?? 0);
      const left =Math.min(...cards.map((c) => c.offsetLeft - c.offsetWidth / 2));
      const right = Math.max(...cards.map((c) => c.offsetLeft + c.offsetWidth / 2));
      const top = Math.min(...cards.map((c) => c.offsetTop - c.offsetHeight / 2));
      const bottom = Math.max(...cards.map((c) => c.offsetTop + c.offsetHeight / 2));
      const scale = Math.min(el.clientWidth / (right - left + 64), (el.clientHeight - reserve - ZOOM_BAR_SPACE) / (bottom - top + 24), 1);
      const x = (left + right) / 2, y = (top + bottom) / 2;
      setFrame((f) => (f.scale === scale && f.x === x && f.y === y ? f : { scale, x, y }));
    };
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    cards.forEach((c) => ro.observe(c));
    fit();
    return () => ro.disconnect();
  }, [W, H, n, reserve]);
  // Scrolling over the zoom bar zooms. So does Ctrl/Cmd + scroll anywhere, which is also what a trackpad pinch sends.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey && !(e.target as HTMLElement).closest(".zoom-bar")) return;
      e.preventDefault();
      setZoom((z) => clampZoom((z ?? frame.scale) * Math.exp(-e.deltaY * 0.002)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [frame.scale]);
  const locked = d.decisions.filter((x) => x.approved_by).length;

  return (
    <div ref={box} className={`board dots ${zoom !== null ? "zoomed" : ""} ${dragging ? "panning" : ""}`} onPointerDown={startPan} onPointerMove={movePan} onPointerUp={endPan} onPointerCancel={endPan}>
      {next && (
        <div className="next-step">
          <span className="next-label">{next.label}</span>
          <span className="next-task" title={next.task.title}>{next.task.title}</span>
          <button className="btn sm" onClick={next.run}>{next.action}</button>
        </div>
      )}
      <div className="stage" style={{ top: `calc(50% + ${(reserve - ZOOM_BAR_SPACE) / 2}px)`, width: W, height: H, transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale}) translate(${-frame.x}px, ${-frame.y}px)`, visibility: frame.scale ? "visible" : "hidden" }}>
        <svg width={W} height={H} aria-hidden>
          {nodes.map((p) => <line key={p.m.id} x1={cx} y1={cy} x2={p.x} y2={p.y} strokeWidth={1.5} stroke={p.active ? "var(--accent)" : "var(--border)"} className={p.active ? "flow" : undefined} />)}
        </svg>
        <div className="node brain" style={{ left: cx, top: cy }}>
          <div className="eyebrow">Team project</div>
          <div className="title">{d.project.name}</div>
          {d.project.brief && <p className="brief">{d.project.brief}</p>}
          <div className="bars">
            {PHASES.map((ph) => {
              const ts = d.tasks.filter((t) => t.phase === ph), dn = ts.filter((t) => t.status === "done").length;
              return (
                <div key={ph} className="bar">
                  <span className="lbl"><BoardIcon name={ph} />{BOARD_PHASE_LABEL[ph]}</span>
                  <div className="track"><div className="fill" style={{ width: `${ts.length ? (dn / ts.length) * 100 : 0}%`, background: "var(--accent)" }} /></div>
                  <span className="num">{dn}/{ts.length}</span>
                </div>
              );
            })}
          </div>
          <div className="split"><span><BoardIcon name="decisions" />{locked} agreed decision{locked === 1 ? "" : "s"}</span><span><BoardIcon name="due" />{dueLabel(d.project.due_date)}</span></div>
          <div className="divider"><Fairness members={d.members} tasks={d.tasks} /></div>
        </div>
        {nodes.map(({ m, x, y, task, mine, active }) => {
          const online = Date.now() - Date.parse(m.last_seen_at) < 5 * 60_000;
          const dn = mine.filter((t) => t.status === "done").length;
          const update = lastUpdate(d, m);
          const logo = aiLogo(m.ai_tool);
          return (
            <div key={m.id} className={`node member ${m.id === d.me.id ? "mine" : ""} ${active ? "working" : ""}`} style={{ left: x, top: y }}>
              <div className="mhead">
                <span className="pair" title={`${m.name} with ${aiName(m.ai_tool)}`}>
                  <span className="avatar">{m.name[0]?.toUpperCase()}</span>
                  <span className="ai-badge">{logo ? <img src={logo} alt={m.ai_tool} /> : <BoardIcon name="ai" />}</span>
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500 }}>{m.name}{m.id === d.me.id && <span className="you">you</span>}</div>
                  {!logo && <div className="small">with {aiName(m.ai_tool)}</div>}
                </div>
                <Dot color={online ? "var(--ok)" : "var(--border)"} title={online ? "Active now" : `Seen ${timeAgo(m.last_seen_at)}`} />
              </div>
              <div className="now">{task ? <><span>{task.title}</span><Chip status={task.status} /></> : <span className="small">Not working on anything yet</span>}</div>
              <div className="small" style={{ marginTop: 8 }}>{mine.length ? `${dn} of ${mine.length} task${mine.length === 1 ? "" : "s"} done` : "No tasks yet"}</div>
              {update && <div className="last-update" title={update.text}><span>{update.text}</span><span>{timeAgo(update.at)}</span></div>}
            </div>
          );
        })}
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

// ---------- Fairness ----------
function Fairness({ members, tasks }: { members: MemberPublic[]; tasks: Task[] }) {
  const f = fairness(members, tasks);
  const pct = Math.round(f.fair * 100);
  return (
    <div>
      <div className="fair-head"><span style={{ fontWeight: 600 }}>Who has done what</span><span className="small">{f.total ? `fair share is ${pct}% each` : "nothing finished yet"}</span></div>
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
function TaskList({ d, byId, a, plain }: Ctx & { plain?: boolean }) {
  const [title, setTitle] = useState("");
  const [phase, setPhase] = useState<Phase>("build");
  return (
    <div>
      {PHASES.map((ph) => {
        const ts = d.tasks.filter((t) => t.phase === ph);
        return (
          <div key={ph} className="sec">
            <div className="sec-t">{plain ? <><BoardIcon name={ph} />{BOARD_PHASE_LABEL[ph]}</> : PHASE_LABEL[ph]} · {ts.filter((t) => t.status === "done").length} of {ts.length} done</div>
            {!ts.length && <div className="small">Nothing here yet</div>}
            {ts.map((t) => {
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
                    <select className="hand" value="" aria-label={`Hand ${t.title} to someone`} onChange={(e) => e.target.value && a.reassign(t, e.target.value)}>
                      <option value="">Hand to…</option>
                      {d.members.filter((m) => m.id !== t.owner_member_id).map((m) => <option key={m.id} value={m.id}>{m.id === d.me.id ? "Me" : m.name}</option>)}
                    </select>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
      <form className="row" onSubmit={(e) => { e.preventDefault(); if (title.trim()) { a.addTask(title, phase); setTitle(""); } }}>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="Add a task…" aria-label="New task" />
        <select className="hand" style={{ borderRadius: 12 }} value={phase} onChange={(e) => setPhase(e.target.value as Phase)} aria-label="Phase">
          {PHASES.map((p) => <option key={p} value={p}>{(plain ? BOARD_PHASE_LABEL : PHASE_LABEL)[p]}</option>)}
        </select>
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
        <p className="small" style={{ margin: "0 0 12px" }}>Your private link tells your AI the brief, your tasks, who is doing what, and what the team agreed.</p>
        <div className="private">🔒 Private link for {d.me.name}</div>
        <div className="wrap-row">
          <button className="btn" onClick={a.copyAgent}>Copy link</button>
          <button className="ghost" onClick={copyText}>Copy as text</button>
          <a className="ghost" href={`/a/${d.me.agent_token}`} target="_blank" rel="noreferrer">Preview</a>
        </div>
        <p className="help"><b>ChatGPT, Claude or Gemini app?</b> Use Copy as text and paste it in.<br /><b>Claude Code, Codex or Cursor?</b> Give it the link. It can post updates by itself.</p>
        <button className="linkbtn" style={{ textDecoration: "underline" }}
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
      if (!t.owner_member_id) list.push({ label: `Claim: ${t.title}`, hint: t.phase, run: () => a.claim(t) });
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
      { label: `Add task: ${q.trim()}`, hint: "build", run: () => a.addTask(q, "build") },
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
