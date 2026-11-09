# Igloo: build plan

Igloo (formerly Groupmind) is the shared place that each group member's own AI plugs into. The idea, rules, data model and API are in [SPEC.md](SPEC.md). The look of the group page is fixed by [group-page-sample.html](group-page-sample.html): open it in a browser, and the app should look like it.

This repo is built from scratch. Each step below has a check, and each step is its own commit.

## How we build

- **Build only what is needed.** Edit an existing file before adding one. Target: the 12 source files listed below, and no more without a reason.
- **Few dependencies.** Runtime: `next`, `react`, `react-dom` and `pg`. Dev: `typescript@5`, type definitions, and `tsx` for the seed and tests.
  - No Tailwind: the CSS is the sample page's plain CSS.
  - No React Flow: the board is the sample's scaled stage, drawn with plain HTML and SVG.
  - No MCP SDK or zod: `/api/mcp` is a small JSON-RPC handler (initialize, tools/list, tools/call).
- **Hard rules** (SPEC section 2):
  - Never call any AI or LLM API.
  - Agent tokens are 64 random hex characters.
  - Agent GET is read only.
  - Validate all input and rate limit it.
  - Never send one member's tokens to another member.
- `lib/core.ts` is pure, because the client imports it. Every write rule lives in `lib/store.ts`, and the UI, agent POST and MCP all call the same functions.
- **The store is async.** The JSON and Postgres backends use the same public functions and write rules.
- `app/actions.ts` exports only real endpoints (every export of a `"use server"` file is public).
- Both `IGLOO UPDATE` and `GROUPMIND UPDATE` headers are accepted.
- After every step, run `npx tsc --noEmit`, `npm test` and the browser check below.

## Files

| File | Role |
|---|---|
| `app/layout.tsx` | Font (Geist through `next/font`) and the page shell |
| `app/globals.css` | The sample's design tokens and classes |
| `app/page.tsx` | Create project form |
| `app/actions.ts` | Server actions (create, join, switch, and member actions) |
| `app/p/[slug]/page.tsx` | Loads data; shows the join form or the app |
| `app/p/[slug]/ui.tsx` | All client UI: join form, header, board, list, side panel, palette, toasts |
| `app/a/[token]/route.ts` | Agent page (GET) and update blocks (POST) |
| `app/api/mcp/route.ts` | MCP server |
| `lib/core.ts` | Types and pure rules: parsers, matching, fairness, digest, agent text |
| `lib/store.ts` | Storage and the shared write rules, plus rate limits |
| `lib/core.test.ts` | Tests for the rules and the store |
| `scripts/seed.ts` | Demo project |

---

## Milestone A. Working app on one machine (this build)

| Step | What | Check |
|---|---|---|
| A1 | Scaffold: Next 15.5, TypeScript, docs, this plan | `npm install` works |
| A2 | `lib/core.ts` and `lib/store.ts` (JSON file), with tests | `npm test` passes, including "a second claim fails" |
| A3 | Create project (`/`) and join with a code (`/p/<slug>`), with a session cookie | Create, then join; a second "ann" is refused |
| A4 | The group page as in the sample: header, board, list, Tasks, Your AI, What's new, Decisions, fairness, palette (N or ⌘K), toasts, and 3 second live polling | Two windows: a claim in A shows in B within 3 seconds; at 375px there's no sideways scroll |
| A5 | Agent link GET and POST, and MCP | curl GET and POST work; MCP `tools/list` works; no token gets 401 |
| A6 | Seed, README, and the full check below | Everything in "Browser check" passes |
| A7 | Private GitHub repo `igloo`, `main` pushed | GitHub shows every commit |

## Milestone B. Postgres (Railway)

1. **You:**
   - Create a Railway project, add a PostgreSQL service, and apply [db/schema.sql](../db/schema.sql).
   - Railway databases are private by default. Since the app is deployed on Vercel, enable **Public Access** on the PostgreSQL service to create a TCP proxy and `DATABASE_PUBLIC_URL`.
   - Put the value of Railway's `DATABASE_PUBLIC_URL` in `.env.local` as `DATABASE_URL`. Never prefix either variable with `NEXT_PUBLIC_`, and never expose the connection string to client code.
2. `lib/store.ts` selects Postgres when `DATABASE_URL` is present. Postgres locks the project row before the shared rules read and change it. Claims of unowned tasks also require `owner_member_id IS NULL` in the update. Changes and activity rows commit together.
3. The unique `(project_id, lower(name))` index backs up the duplicate-name check.
- **Check:**
  - All of the browser check passes on Postgres.
  - 10 concurrent claims give exactly one owner.
  - Without `DATABASE_URL`, the app still uses the JSON file.

## Milestone C. Shared rate limits

- Postgres rate limits use `rate_hits(key, at)`. A transaction locks each hashed key before counting and inserting a hit. JSON mode uses process-local counters.
- The limits don't change:

  | Action | Limit |
  |---|---|
  | Create | 10 per hour per IP |
  | Join | 10 per 10 minutes per IP and slug |
  | Paste back | 30 per 10 minutes per member |
  | Agent POST | 30 per 10 minutes per token |
  | MCP | 60 per 10 minutes per token |

- **Check:** the 11th join in 10 minutes is refused, even after a restart.

## Milestone D. Deploy on Vercel

1. **You:** import the repo in Vercel and follow the [README deployment steps](../README.md#deploy) to set `DATABASE_URL` to Railway's public endpoint with TLS.
2. Seed the demo project once.
3. **Check:**
   - A phone on mobile data can create, join and use the board.
   - A browsing AI can open an agent link.
   - A `curl` POST works from another machine.
   - `claude mcp add --transport http igloo "https://<domain>/api/mcp?token=<token>"` works.
   - The production page source has no session token and no other member's agent token.

## Milestone E. Rejoin, gaps, finish

1. **Use on another device:**
   - A one-time code (random, 10 minute expiry) stored on the member. Never reuse the agent token for this.
   - The link `/p/<slug>?rejoin=1#device=<code>` prompts for confirmation, then sets a session cookie on the receiving host. The fragment keeps the code out of the initial HTTP request.
   - It's rate limited like joins.
2. **Edit project** (name, brief and due date). Any member can, and it's logged.
3. **Leave the group:** unclaims unfinished tasks, and it's logged.
4. **Make a new agent link:** the old link returns 404.
5. **Delete a task:** owner, or anyone with a log entry.
6. **Empty states:** 0 tasks with 1 member. **Accessibility pass.**
7. **Wrap up:**
   - Update the README.
   - `grep -riE "openai|anthropic|gemini|embedding" app lib scripts package.json` finds only UI words.
   - Tag `v1.0`.

**Later:** server-sent events, agents suggesting decisions or tasks (a human still agrees), per-task history, and export to markdown.

---

## Browser check (run after every step)

1. On `/`, choose "Use example" and then Create. You land on `/p/<slug>?code=<code>`.
2. In window A, join as Ann with Claude. In a private window B, join as Ben with ChatGPT. Joining as "ann" a third time is refused.
3. A claims a task. B tries the same task and sees "Ann already has this".
4. In A, open Your AI and then Preview. It's plain text with Ann's tasks and the update format.
5. In A, paste an `IGLOO UPDATE` block (task, status: done, note) and Save. B gets a toast within 3 seconds.
6. A suggests a decision. A can't agree to it. B agrees, and the agent page lists it under Locked decisions.
7. "Copy update for group chat" gives the digest.
8. Press N, type a new task name, and choose "Add task".
9. At 375px wide, the board is 460px tall and there's no sideways scroll.
10. **curl:**
    - `curl -s localhost:3000/a/<token>`.
    - A POST of an update block returns `saved: …`.
    - Updating a teammate's task returns 422 `skipped: … owns this task`.
11. **MCP:**
    - A POST without a token gets 401.
    - With a token, `tools/list` lists 5 tools.

## Things only you can do

- Create the Railway project and PostgreSQL service, enable database Public Access, and paste the `DATABASE_PUBLIC_URL` value into `.env.local` and Vercel under the name `DATABASE_URL`.
- Connect the GitHub repo in Vercel.
