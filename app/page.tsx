"use client";
import { useActionState, useState } from "react";
import { createProject, joinProject } from "./actions";
import { AI_TOOLS, parseTaskLines, PHASES } from "@/lib/core";
import { Aurora } from "@/components/ui/aurora";

const EXAMPLE = {
  name: "Campus Coffee App pitch",
  context: "Marketing 301",
  brief: "Pitch a mobile ordering app for the campus coffee cart. Audience is the Marketing 301 panel. 5 minute pitch plus a clickable prototype.",
  tasks: "Research\nSurvey 30 students on coffee habits\nCompetitor scan of campus cafes\n\nBuild\nPersona and journey map\nClickable app prototype\nPricing and loyalty model\n\nPresent\nPitch deck\nRehearse the 5 minute pitch",
};

const TOOLS = [["claude", "Claude"], ["chatgpt", "ChatGPT"], ["gemini", "Gemini"], ["cursor", "Cursor"], ["copilot", "Copilot"]];
const SAMPLE_PHASES: [string, number, number][] = [["Research", 2, 2], ["Build", 1, 3], ["Present", 0, 2]];
const SAMPLE_MEMBERS = [
  { name: "Aisha", logo: "claude", task: "Pitch deck", status: "doing", label: "In progress" },
  { name: "Ben", logo: "chatgpt", task: "Clickable prototype", status: "todo", label: "To do" },
  { name: "Mei", logo: "gemini", task: "Survey 30 students", status: "done", label: "Done" },
];

// A static picture of the board, so people see the product before filling anything in.
function BoardPreview() {
  return (
    <div className="lp-preview" aria-hidden="true">
      <div className="lp-project">
        <div className="eyebrow">Team project</div>
        <div className="title">Campus Coffee App pitch</div>
        <div className="bars">
          {SAMPLE_PHASES.map(([label, done, total]) => (
            <div key={label} className="bar">
              <span className="lbl">{label}</span>
              <div className="track"><div className="fill" style={{ width: `${(done / total) * 100}%`, background: "var(--teal)" }} /></div>
              <span className="num">{done}/{total}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="lp-members">
        {SAMPLE_MEMBERS.map((m) => (
          <div key={m.name} className={`lp-member ${m.status === "doing" ? "working" : ""}`}>
            <div className="lp-name">
              <span className="pair">
                <span className="avatar">{m.name[0]}</span>
                <span className="ai-badge"><img src={`/ai/${m.logo}.svg`} alt="" /></span>
              </span>
              {m.name}
            </div>
            <div className="lp-task">{m.task}</div>
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
  const onLink =(value: string) => {
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

export default function CreatePage() {
  const [mode, setMode] = useState<"join" | "create">("join");
  const [state, action, pending] = useActionState(createProject, undefined);
  const [f, setF] = useState({ name: "", context: "", due: "", brief: "", tasks: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const parsed = parseTaskLines(f.tasks);
  const count = parsed.length
    ? `${parsed.length} task${parsed.length > 1 ? "s" : ""}: ` + PHASES.map((p) => `${parsed.filter((t) => t.phase === p).length} ${p}`).join(", ")
    : "One task per line. A line that says Research, Build or Present starts a new phase.";

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
        <div hidden={mode !== "create"}>
        <form action={action} className="form">
          <div className="two">
            <div>
              <label className="label" htmlFor="name">Project name</label>
              <input id="name" name="name" required maxLength={120} className="input" value={f.name} onChange={set("name")} placeholder="Campus Coffee App pitch" />
            </div>
            <div>
              <label className="label" htmlFor="context">Course or context</label>
              <input id="context" name="context" maxLength={120} className="input" value={f.context} onChange={set("context")} placeholder="Marketing 301" />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="due">Due date</label>
            <input id="due" name="due" type="date" className="input" value={f.due} onChange={set("due")} />
          </div>
          <div>
            <label className="label" htmlFor="brief">Brief</label>
            <textarea id="brief" name="brief" rows={2} maxLength={5000} className="input" value={f.brief} onChange={set("brief")} placeholder="What the project is, who it's for, what done looks like" />
          </div>
          <div>
            <label className="label" htmlFor="tasks">Tasks</label>
            <textarea id="tasks" name="tasks" rows={6} maxLength={20000} className="input" value={f.tasks} onChange={set("tasks")} placeholder={"Research\nSurvey 30 students\n\nBuild\nPrototype\n\nPresent\nPitch deck"} />
            <p className="small" style={{ margin: "6px 0 0" }}>{count}</p>
          </div>
          {state?.error && <p className="err">{state.error}</p>}
          <div className="row">
            <button type="button" className="ghost" onClick={() => setF({ ...EXAMPLE, due: new Date(Date.now() + 9 * 86400000).toISOString().slice(0, 10) })}>Use example</button>
            <button className="btn" style={{ flex: 1, padding: "10px 16px", fontSize: 14 }} disabled={pending}>{pending ? "Creating…" : "Create project"}</button>
          </div>
        </form>
        </div>
        </div>
        <p className="lp-note">No AI on our side. Just the shared brain your AIs plug into.</p>
        </section>
      </div>
    </main>
  );
}
