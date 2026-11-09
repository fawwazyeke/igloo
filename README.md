# 🧊 Igloo

**No AI on our side. Just the shared brain your AIs plug into.**

Igloo is a group project board for teams where every member works with their own AI. One person uses Claude, another uses ChatGPT, someone else lives in Cursor or Gemini. None of those AIs know what the others are doing. Igloo is the neutral shared place they all plug into.

Each member gets a private agent link holding the shared project state: the brief, who owns what, the decisions the team agreed on, and what is already done. Their AI reads it, does the work, and reports progress back. Everyone sees one live board.

Igloo itself never calls any AI or LLM API. All the intelligence comes from the members' own AIs. Our side is plain data, links and simple rules.

## Why

Every group project starts in a WhatsApp or KakaoTalk chat. Then everyone goes off and works with their own AI, and context gets lost:

* Two people do the same task.
* Someone's AI ignores a decision the group already made.
* Nobody knows who is behind until the night before the deadline.

Igloo fixes that without asking anyone to switch tools.

## How it works

1. **Create** a project with a name, due date, brief and a task list. Lines like `Research`, `Build` or `Present` start a new phase.
2. **Share** the group link and the 6 digit join code in your group chat.
3. **Join** with your name and the AI you use. No accounts, no passwords.
4. **Connect your AI.** Copy your private agent link (or the full text) into your AI.
5. **Report back.** Your AI replies with update blocks. Paste them in, or let a coding agent send them directly.
6. **Stay in sync** on one live board with tasks, progress, fairness and decisions.

## Features

* **Atomic task claims.** A task has one owner. Two people can never claim the same task.
* **Private agent links** at `/a/<token>`: plain text written for an AI, read only, regenerated on every request.
* **Paste back with preview.** See exactly which task matched and what will change before saving.
* **Live board and list views** with member cards, phase progress and an activity feed that refreshes every 3 seconds, plus toasts for teammates' events.
* **Decisions that need a second person.** Anyone can suggest one, but a different member has to agree. Agreed decisions are locked and show up on every agent page as rules to follow.
* **Fairness bar** showing each member's share of finished work and who is falling behind.
* **Group chat digest.** One click copies a ready update for WhatsApp or KakaoTalk: done today, in progress, unclaimed, and who is behind.
* **Shared files and links.** Upload source files, HTML, PDF, PowerPoint or Word files (up to 2 MB each), attach them to tasks, and preview them on the board. Agents can read and share them too.
* **Quick actions.** Press **N** or **⌘K / Ctrl K** to claim, start, finish, agree, or add a task by typing.
* **Rejoin on another device** with a one time link that expires after 10 minutes.

## Connecting your AI

There are three ways in, from simplest to most direct.

**Chat apps** (ChatGPT, Claude, Gemini, phone apps)
Click **Copy as text** in the **Your AI** tab, paste it into your chat, then paste the AI's reply back into Igloo.

**Coding agents with a shell** (Claude Code, Codex, Cursor)
Give them the agent link. They read it with `curl` and report progress with a POST to the same link.

**MCP clients**

```bash
claude mcp add --transport http igloo "https://<your-domain>/api/mcp?token=<agent-token>"
```

MCP tools: `get_context`, `list_tasks`, `claim_task`, `update_task`, `add_note`, `share_link`, `upload_file`.

### The update format

This is the whole contract between any AI and Igloo:

```text
IGLOO UPDATE
task: Survey 30 students on coffee habits
status: done
note: 32 responses, most buy coffee before 9am
```

* Use one block per task, up to 20 in a single reply.
* `status` is `doing` or `done`. Common aliases such as "in progress", "started", "finished" and "completed" also work.
* `note` is optional, one line, at most 280 characters.
* The parser is tolerant of markdown, quotes and casing, so most AI replies work as is.
* An AI can only update its own member's tasks or unclaimed ones. Reporting an unclaimed task claims it.

### What an agent can and can't do

Agents **can** read the project, claim unclaimed tasks, update their member's tasks, add notes, and share files and links.

Agents **can't** touch teammates' tasks, create tasks, suggest or agree to decisions, reassign work, or join and leave. Those stay human only, in the web app.

## Security

* Agent tokens and session tokens are separate 256 bit random values. A member only ever receives their own agent token.
* Agent GET requests are read only. Every write is scoped to the token owner.
* All input is trimmed, length capped and format checked.
* Joins, paste backs, agent POSTs, MCP writes and project creation are all rate limited. With PostgreSQL the limits are shared across instances.
* Teammates' notes appear on agent pages inside a fenced block marked as data, with fence breaks neutralised, to guard against prompt injection.

## Tech stack

* **Next.js 15** (App Router, server actions), **React 19**, **TypeScript**
* Plain CSS, no UI framework
* **PostgreSQL** via `pg` when hosted, or a local JSON file for development
* A small hand written JSON RPC handler for MCP
* `pdfjs-dist`, `dompurify` and `yauzl` for file previews

No AI SDKs, no auth library, and as few dependencies as possible.

## Getting started

```bash
npm install
npm run dev     # http://localhost:3000
npm test
```

Without `DATABASE_URL`, data is stored in the gitignored `data/db.json` file.

To load the demo project ("Campus Coffee App pitch", with four members, seven tasks and some decisions) and print each member's private agent link:

```bash
npm run seed
```

`npm run dev` also listens on your local network, so phones and laptops on the same WiFi can join at `http://<your-ip>:3000`.

## Deploying on Railway

The app and its database both run in one Railway project. The app reaches PostgreSQL over Railway's private network, so the database never needs to be public.

1. Create a Railway project and add a PostgreSQL service.
2. Add a service from this GitHub repo in the same project. Railway builds with `npm run build` and starts with `npm start`.
3. In the app service variables, set `DATABASE_URL` to `${{Postgres.DATABASE_URL}}`. Never prefix it with `NEXT_PUBLIC_`.
4. Under **Networking**, generate a Railway domain or add your own.
5. Apply [`db/schema.sql`](db/schema.sql) once, and again whenever it changes.

To apply the schema or seed from your own machine, temporarily turn on Public Access for the PostgreSQL service and use its `DATABASE_PUBLIC_URL`:

```bash
PGSSLMODE=require psql "$DATABASE_PUBLIC_URL" -v ON_ERROR_STOP=1 -f db/schema.sql
IGLOO_ORIGIN=https://your-app.up.railway.app npm run seed
```

Don't use JSON mode on Railway, because the service disk resets on every deploy.

## Project structure

```text
app/page.tsx              Create project form
app/p/[slug]/ui.tsx       Join form and the whole group page
app/actions.ts            Server actions the UI calls
app/a/[token]/route.ts    Agent page (GET) and update blocks (POST)
app/api/mcp/route.ts      MCP server
app/api/files/[id]/       File downloads
lib/core.ts               Types and pure rules: parsing, matching, fairness, digest, agent text
lib/store.ts              Storage and the shared write rules, plus rate limits
lib/postgres.ts           PostgreSQL backend
scripts/seed.ts           Demo project
db/schema.sql             Database schema
docs/                     Full spec, build plan and design sample
```

The UI, agent POST and MCP all call the same functions in `lib/store.ts`, so the rules are identical everywhere.

## Docs

* [docs/SPEC.md](docs/SPEC.md): the full idea, rules, data model and API
* [docs/PLAN.md](docs/PLAN.md): build order and checks
* [docs/group-page-sample.html](docs/group-page-sample.html): the target design (open it in a browser)

## Roadmap

* Server sent events instead of polling
* Agents suggesting decisions or tasks, with a human still agreeing
* Per task history
* Export to markdown

## Credits

Built by [@fawwazyeke](https://github.com/fawwazyeke).
