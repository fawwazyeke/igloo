import { loadEnvFile } from "node:process";
import type { Member, Result } from "../lib/core";
import type { NewProject } from "../lib/store";
import * as store from "../lib/store";

const slug = "campus-coffee";
const code = "482913";
const tasks: NewProject["tasks"] = [
  { phase: "research", title: "Survey 30 students on coffee habits" },
  { phase: "research", title: "Competitor scan of campus cafes" },
  { phase: "build", title: "Clickable app prototype" },
  { phase: "build", title: "Pricing and loyalty model" },
  { phase: "build", title: "Persona and journey map" },
  { phase: "present", title: "Pitch deck" },
  { phase: "present", title: "Rehearse the 5 minute pitch" },
];

function check(result: Result) {
  if (result.error) throw new Error(result.error);
}

async function join(name: string, ai_tool: string) {
  const result = await store.joinProject(slug, { name, ai_tool, code });
  check(result);
  const member = await store.memberBySession(slug, result.session);
  if (!member) throw new Error(`Could not load ${name}`);
  return member;
}

async function decision(text: string, from: Member, approvedBy?: Member) {
  check(await store.proposeDecision(from, text));
  if (!approvedBy) return;
  const board = await store.getBoard(slug);
  const entry = board?.decisions.find((item) => item.text === text);
  if (!entry) throw new Error(`Could not load decision: ${text}`);
  check(await store.approveDecision(approvedBy, entry.id));
}

async function main() {
  try { loadEnvFile(".env.local"); } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  const origin = new URL(process.env.IGLOO_ORIGIN ?? "http://localhost:3000").origin;
  await store.deleteProject(slug);
  const result = await store.createProject({
    name: "Campus Coffee App pitch", context: "Marketing 301",
    brief: "Pitch a mobile ordering app for the campus coffee cart. Audience is the Marketing 301 panel.",
    due: new Date(Date.now() + 9 * 86_400_000).toISOString().slice(0, 10),
    tasks,
  }, { slug, code });
  if ("error" in result) throw new Error(result.error);
  const aisha = await join("Aisha", "Claude");
  const minjun = await join("Minjun", "ChatGPT");
  const daniel = await join("Daniel", "Gemini");
  const sofia = await join("Sofia", "Cursor");
  const board = await store.getBoard(slug);
  if (!board) throw new Error("Could not load the demo board");
  for (const [index, owner, status] of [
    [0, aisha, "done"], [1, minjun, "done"], [2, sofia, "doing"], [3, daniel, "doing"], [4, aisha, "done"],
  ] as const) {
    check(await store.setTaskStatus(owner, board.tasks[index].id, status));
  }
  check(await store.addNote(sofia, "Prototype has order and pay screens, loyalty screen next"));
  await decision("Target audience is first year students living on campus", aisha, minjun);
  await decision("Loyalty is a stamp card: 9 coffees, 10th free", daniel, sofia);
  await decision("Deck has at most 10 slides", minjun);
  console.log(`Board: ${origin}/p/${slug} (join code ${code})`);
  for (const member of [aisha, minjun, daniel, sofia]) {
    console.log(`${member.name}: ${origin}/a/${member.agent_token}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
