"use client";
import { useActionState, useState } from "react";
import { createProject } from "./actions";
import { parseTaskLines, PHASES } from "@/lib/core";

const EXAMPLE = {
  name: "Campus Coffee App pitch",
  context: "Marketing 301",
  brief: "Pitch a mobile ordering app for the campus coffee cart. Audience is the Marketing 301 panel. 5 minute pitch plus a clickable prototype.",
  tasks: "Research\nSurvey 30 students on coffee habits\nCompetitor scan of campus cafes\n\nBuild\nPersona and journey map\nClickable app prototype\nPricing and loyalty model\n\nPresent\nPitch deck\nRehearse the 5 minute pitch",
};

export default function CreatePage() {
  const [state, action, pending] = useActionState(createProject, undefined);
  const [f, setF] = useState({ name: "", context: "", due: "", brief: "", tasks: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const parsed = parseTaskLines(f.tasks);
  const count = parsed.length
    ? `${parsed.length} task${parsed.length > 1 ? "s" : ""}: ` + PHASES.map((p) => `${parsed.filter((t) => t.phase === p).length} ${p}`).join(", ")
    : "One task per line. A line that says Research, Build or Present starts a new phase.";

  return (
    <main className="page dots">
      <div className="page-inner">
        <div className="ctx">Igloo</div>
        <h1>Start a group project</h1>
        <p className="lead">Everyone keeps their own AI. Igloo is the shared place those AIs plug into.</p>
        <form action={action} className="card form">
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
            <textarea id="brief" name="brief" rows={3} maxLength={5000} className="input" value={f.brief} onChange={set("brief")} placeholder="What the project is, who it's for, what done looks like" />
          </div>
          <div>
            <label className="label" htmlFor="tasks">Tasks</label>
            <textarea id="tasks" name="tasks" rows={9} maxLength={20000} className="input" value={f.tasks} onChange={set("tasks")} placeholder={"Research\nSurvey 30 students\n\nBuild\nPrototype\n\nPresent\nPitch deck"} />
            <p className="small" style={{ margin: "6px 0 0" }}>{count}</p>
          </div>
          {state?.error && <p className="err">{state.error}</p>}
          <div className="row">
            <button type="button" className="ghost" onClick={() => setF({ ...EXAMPLE, due: new Date(Date.now() + 9 * 86400000).toISOString().slice(0, 10) })}>Use example</button>
            <button className="btn" style={{ flex: 1, padding: "10px 16px", fontSize: 14 }} disabled={pending}>{pending ? "Creating…" : "Create project"}</button>
          </div>
        </form>
        <p className="small" style={{ textAlign: "center", marginTop: 16 }}>No AI on our side. Just the shared brain your AIs plug into.</p>
      </div>
    </main>
  );
}
