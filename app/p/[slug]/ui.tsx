"use client";
// The whole group page, laid out like docs/group-page-sample.html.
import { useActionState, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import * as A from "@/app/actions";
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
          {view === "board" ? <Board d={d} /> : (
            <div className="list dots">
              <div className="stack">
                <div className="card"><Fairness members={d.members} tasks={d.tasks} /></div>
                <div className="card"><TaskList {...ctx} /></div>
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
function Board({ d }: { d: AppData }) {
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
    const fit = () => setScale(Math.min(el.clientWidth / (W + 40), el.clientHeight / (H + 40), 1));
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    fit();
    return () => ro.disconnect();
  }, [W, H]);
  const locked = d.decisions.filter((x) => x.approved_by).length;

  return (
    <div ref={box} className="board dots">
      <div className="stage" style={{ width: W, height: H, transform: `scale(${scale}) translate(${-cx}px, ${-cy}px)`, visibility: scale ? "visible" : "hidden" }}>
        <svg width={W} height={H} aria-hidden>
          {nodes.map((p) => <line key={p.m.id} x1={cx} y1={cy} x2={p.x} y2={p.y} strokeWidth={1.5} stroke={p.active ? p.m.color : "#ebe4d8"} className={p.active ? "flow" : undefined} />)}
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
              <div className="now">{task ? <><span>{task.title}</span><Chip status={task.status} /></> : <span className="small">Not working on anything yet</span>}</div>
              <div className="small" style={{ marginTop: 8 }}>{mine.length ? `${dn} of ${mine.length} task${mine.length === 1 ? "" : "s"} done` : "No tasks yet"}</div>
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
function TaskList({ d, byId, a }: Ctx) {
  const [title, setTitle] = useState("");
  const [phase, setPhase] = useState<Phase>("build");
  return (
    <div>
      {PHASES.map((ph) => {
        const ts = d.tasks.filter((t) => t.phase === ph);
        return (
          <div key={ph} className="sec">
            <div className="sec-t">{PHASE_LABEL[ph]} · {ts.filter((t) => t.status === "done").length} of {ts.length} done</div>
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
          {PHASES.map((p) => <option key={p} value={p}>{PHASE_LABEL[p]}</option>)}
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
