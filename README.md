# Igloo

No AI on our side. Just the shared brain your AIs plug into.

A group project board where every member keeps their own AI (Claude, ChatGPT, Gemini, Cursor…). Each member's AI gets a private link with the shared state, and reports progress back.

- **Full idea and rules:** [docs/SPEC.md](docs/SPEC.md)
- **Build order and checks:** [docs/PLAN.md](docs/PLAN.md)
- **Target look of the group page:** [docs/group-page-sample.html](docs/group-page-sample.html) (open it in a browser)

## Run it

```bash
npm install
npm run dev     # http://localhost:3000
npm test
```

Data is kept in `data/db.json`, which is gitignored and created on first use.

## Where the UI lives

| File | What |
|---|---|
| `app/globals.css` | All styles: the sample page's CSS, plain, no framework |
| `app/page.tsx` | Create project form |
| `app/p/[slug]/ui.tsx` | Join form and the whole group page: header, board, list, Tasks, Your AI, What's new, Decisions, quick actions (N or ⌘K), toasts |
| `app/actions.ts` | Server actions the UI calls (all the rules live in `lib/store.ts`) |

## Status

**Working:**
- Create, join with a code, the board and list, claim, start, done, unclaim and hand to.
- Add task, paste back with preview, decisions with a second person agreeing, and the digest.
- Live updates every 3 seconds, and toasts.

**Not built yet:**
- The agent link `/a/<token>`. This means **Preview** and **Copy as text** in "Your AI" don't work yet.
- MCP (`/api/mcp`).
- The demo seed.
- Postgres and deploy. See the plan.

Rules: never call any AI or LLM API, and add files and dependencies only when they're needed.
