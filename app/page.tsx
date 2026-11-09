"use client";
import { useActionState, useState } from "react";
import { createProject } from "./actions";
import { LIMIT, clean } from "@/lib/core";

const EXAMPLE = {
  name: "Campus Coffee App pitch",
  description: "Pitch a mobile ordering app for the campus coffee cart. Audience is the Marketing 301 panel. 5 minute pitch plus a clickable prototype.",
  tasks: ["Survey 30 students on coffee habits", "Competitor scan of campus cafes", "Persona and journey map", "Clickable app prototype", "Pricing and loyalty model", "Pitch deck", "Rehearse the 5 minute pitch"],
};

export default function CreatePage() {
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
    <main className="page dots">
      <div className="page-inner">
        <div className="ctx">Igloo</div>
        <h1>Start a group project</h1>
        <p className="lead">Everyone keeps their own AI. Igloo is the shared place those AIs plug into.</p>
        <form action={action} className="card form">
          <div>
            <label className="label" htmlFor="name">Project name</label>
            <input id="name" name="name" required maxLength={LIMIT.projectName} className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Campus Coffee App pitch" />
          </div>
          <div>
            <label className="label" htmlFor="description">Description <span className="optional">(optional)</span></label>
            <textarea id="description" name="brief" rows={3} maxLength={LIMIT.brief} className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What the project is, who it's for, what done looks like" />
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
        <p className="small" style={{ textAlign: "center", marginTop: 16 }}>No AI on our side. Just the shared brain your AIs plug into.</p>
      </div>
    </main>
  );
}
