"use client";
import { useActionState, useState } from "react";
import { createProject, joinProject } from "./actions";
import { AI_TOOLS, LIMIT, clean } from "@/lib/core";
import { Aurora } from "@/components/ui/aurora";

const EXAMPLE = {
  name: "Campus Coffee App pitch",
  description: "Pitch a mobile ordering app for the campus coffee cart. Audience is the Marketing 301 panel. 5 minute pitch plus a clickable prototype.",
  tasks: ["Survey 30 students on coffee habits", "Competitor scan of campus cafes", "Persona and journey map", "Clickable app prototype", "Pricing and loyalty model", "Pitch deck", "Rehearse the 5 minute pitch"],
};

const TOOLS = [["claude", "Claude"], ["chatgpt", "ChatGPT"], ["gemini", "Gemini"], ["cursor", "Cursor"], ["copilot", "Copilot"]];
const SAMPLE_TASKS = [
  { name: "Aisha", logo: "claude", task: "Pitch deck", status: "doing", label: "In progress" },
  { name: "Ben", logo: "chatgpt", task: "Clickable prototype", status: "todo", label: "To do" },
  { name: "Mei", logo: "gemini", task: "Survey 30 students", status: "done", label: "Done" },
];

// A static picture of the board, so people see the product before filling anything in:
// the project in the middle and its tasks below, each with the person and AI working on it.
function BoardPreview() {
  return (
    <div className="lp-preview" aria-hidden="true">
      <div className="lp-project">
        <div className="eyebrow">Team project</div>
        <div className="title">Campus Coffee App pitch</div>
        <div className="bars">
          <div className="bar">
            <span className="lbl">Tasks done</span>
            <div className="track"><div className="fill" style={{ width: "43%", background: "var(--teal)" }} /></div>
            <span className="num">3/7</span>
          </div>
        </div>
      </div>
      <div className="lp-members">
        {SAMPLE_TASKS.map((m) => (
          <div key={m.name} className={`lp-member ${m.status === "doing" ? "working" : ""}`}>
            <div className="lp-task">{m.task}</div>
            <div className="lp-name">
              <span className="pair">
                <span className="avatar">{m.name[0]}</span>
                <span className="ai-badge"><img src={`/ai/${m.logo}.svg`} alt="" /></span>
              </span>
              {m.name}
            </div>
            <span className={`chip ${m.status}`}>{m.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Accepts a project link, a whole pasted invite message, or a bare slug.
const slugFrom = (text: string) => text.trim().match(/\/p\/([^/?#\s]+)/)?.[1] ?? text.trim();

function JoinPanel() {
  const [state, action, pending] = useActionState(joinProject, undefined);
  const [tool, setTool] = useState("Claude");
  const [link, setLink] = useState("");
  const [code, setCode] = useState("");
  // Controlled so a wrong code doesn't wipe them: React resets uncontrolled fields after a form action.
  const [name, setName] = useState("");
  const [otherTool, setOtherTool] = useState("");
  const onLink = (value: string) => {
    setLink(value);
    const found = value.match(/(?:code=|Code:\s*)(\d{6})/);
    if (found) setCode(found[1]);
  };

  return (
    <form action={action} className="form lp-join">
      <input type="hidden" name="slug" value={slugFrom(link)} />
      <div>
        <label className="label" htmlFor="join-link">Project link</label>
        <input id="join-link" required className="input" value={link} onChange={(e) => onLink(e.target.value)} placeholder="Paste your invite link" />
      </div>
      <div>
        <label className="label" htmlFor="join-name">Your name</label>
        <input id="join-name" name="name" required maxLength={40} className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Aisha" />
      </div>
      <div>
        <span className="label">Your AI</span>
        <div className="lp-ai-grid">
          {AI_TOOLS.map((t) => {
            const file = TOOLS.find(([, name]) => name === t)?.[0];
            return (
              <button key={t} type="button" className={tool === t ? "on" : ""} aria-pressed={tool === t} title={t} onClick={() => setTool(t)}>
                {file ? <img src={`/ai/${file}.svg`} alt={t} /> : t}
              </button>
            );
          })}
        </div>
        {tool === "Other"
          ? <input name="ai_tool" required maxLength={40} className="input" style={{ marginTop: 8 }} value={otherTool} onChange={(e) => setOtherTool(e.target.value)} placeholder="Which AI?" aria-label="Which AI?" />
          : <input type="hidden" name="ai_tool" value={tool} />}
      </div>
      <div>
        <label className="label" htmlFor="join-code">Join code</label>
        <input id="join-code" name="code" required inputMode="numeric" pattern="\d{6}" maxLength={6} className="input code-input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="000000" />
      </div>
      {state?.error && <p className="err">{state.error}</p>}
      <button className="btn big" disabled={pending}>{pending ? "Joining…" : "Join project"}</button>
    </form>
  );
}

// Project name, an optional description, and tasks typed as pills (Enter adds one).
function CreatePanel() {
  const [state, action, pending] = useActionState(createProject, undefined);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tasks, setTasks] = useState<string[]>([]);
  const [draft, setDraft] = useState("");

  // Add one or more titles (a paste with several lines adds one pill per line), skipping repeats.
  const add = (text: string) => {
    const titles = text.split(/\r?\n/).map((t) => clean(t, LIMIT.title)).filter(Boolean);
    if (!titles.length) return;
    setTasks((current) => {
      const next = [...current];
      for (const t of titles) {
        if (next.length < LIMIT.tasksOnCreate && !next.some((x) => x.toLowerCase() === t.toLowerCase())) next.push(t);
      }
      return next;
    });
  };
  const remove = (i: number) => setTasks((current) => current.filter((_, j) => j !== i));
  // A title still in the box when Create is pressed counts too.
  const pendingTitle = clean(draft, LIMIT.title);
  const submitted = pendingTitle && !tasks.some((t) => t.toLowerCase() === pendingTitle.toLowerCase()) ? [...tasks, pendingTitle] : tasks;

  return (
    <form action={action} className="form">
      <div>
        <label className="label" htmlFor="name">Project name</label>
        <input id="name" name="name" required maxLength={LIMIT.projectName} className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Campus Coffee App pitch" />
      </div>
      <div>
        <label className="label" htmlFor="description">Description <span className="optional">(optional)</span></label>
        <textarea id="description" name="brief" rows={2} maxLength={LIMIT.brief} className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What the project is, who it's for, what done looks like" />
      </div>
      <div>
        <label className="label" htmlFor="tasks">Tasks</label>
        <div className="input task-input" onClick={(e) => (e.currentTarget.querySelector("input") as HTMLInputElement | null)?.focus()}>
          {tasks.map((t, i) => (
            <span key={t} className="task-pill">
              <span>{t}</span>
              <button type="button" aria-label={`Remove ${t}`} onClick={() => remove(i)}>×</button>
            </span>
          ))}
          <input
            id="tasks" value={draft} maxLength={LIMIT.title}
            placeholder={tasks.length ? "Add another task" : "Type a task and press Enter"}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (!e.nativeEvent.isComposing) { add(draft); setDraft(""); }
              } else if (e.key === "Backspace" && !draft && tasks.length) {
                remove(tasks.length - 1);
              }
            }}
            onPaste={(e) => {
              const text = e.clipboardData.getData("text");
              if (/\r?\n/.test(text)) { e.preventDefault(); add(draft + text); setDraft(""); }
            }}
          />
        </div>
        {submitted.map((t) => <input key={t} type="hidden" name="task" value={t} />)}
        <p className="small" style={{ margin: "6px 0 0" }}>
          {tasks.length ? `${tasks.length} task${tasks.length > 1 ? "s" : ""}. ` : ""}Press Enter to add a task.
        </p>
      </div>
      {state?.error && <p className="err">{state.error}</p>}
      <div className="row">
        <button type="button" className="ghost" onClick={() => { setName(EXAMPLE.name); setDescription(EXAMPLE.description); setTasks(EXAMPLE.tasks); setDraft(""); }}>Use example</button>
        <button className="btn" style={{ flex: 1, padding: "10px 16px", fontSize: 14 }} disabled={pending}>{pending ? "Creating…" : "Create project"}</button>
      </div>
    </form>
  );
}

export default function HomePage() {
  const [mode, setMode] = useState<"join" | "create">("join");
  return (
    <main className="landing">
      <Aurora className="canvas-aurora" />
      <a href="/" className="igloo-wordmark" aria-label="Igloo home">igloo.</a>
      <div className="lp-grid">
        <section className="lp-hero">
          <h1>One Shared Brain For Your Teams&apos; AIs</h1>
          <div className="lp-tools">
            <span>Bring your own</span>
            {TOOLS.map(([file, name]) => <div key={file} className="lp-tool" title={name}><img src={`/ai/${file}.svg`} alt={name} /></div>)}
          </div>
          <BoardPreview />
        </section>
        <section className="lp-form">
          <div className="card lp-card">
            <div className="lp-tabs" role="group" aria-label="Join or create a project">
              <button type="button" className={mode === "join" ? "on" : ""} aria-pressed={mode === "join"} onClick={() => setMode("join")}>JOIN A PROJECT</button>
              <button type="button" className={mode === "create" ? "on" : ""} aria-pressed={mode === "create"} onClick={() => setMode("create")}>CREATE A PROJECT</button>
            </div>
            <div hidden={mode !== "join"}><JoinPanel /></div>
            <div hidden={mode !== "create"}><CreatePanel /></div>
          </div>
          <p className="lp-note">No AI on our side. Just the shared brain your AIs plug into.</p>
        </section>
      </div>
    </main>
  );
}
