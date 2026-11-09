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

Without `DATABASE_URL`, data is kept in the gitignored `data/db.json` file. Run `npm run seed` to reset the Campus Coffee demo and print its private agent links.

On a joined board, use **Add file** to share source, HTML, PDFs, PowerPoint decks, or Word documents (up to 2 MB each). Attach a file to a task or leave it in the project library. The latest three uploads appear as board nodes and all uploads are in **Files**. Cards show the first page of a PDF, a static HTML preview, or an embedded Office cover when available. HTML source is also available in the file details. Agents can download project files from their private context.

For an existing PostgreSQL database, reapply `db/schema.sql` before running this version. The schema creates the file table while keeping existing project data.

## Deploy

1. Add a PostgreSQL service in Railway and enable [Public Access](https://docs.railway.com/databases/postgresql#connecting-externally) so Vercel can connect.
2. Apply [db/schema.sql](db/schema.sql). With the original Railway public URL stored in your shell as `DATABASE_PUBLIC_URL`, run `PGSSLMODE=require psql "$DATABASE_PUBLIC_URL" -v ON_ERROR_STOP=1 -f db/schema.sql`.
3. Import the repo in Vercel and set its server-only `DATABASE_URL` to the public connection string before deploying. For the standard Railway template, append `?sslmode=require&uselibpqcompat=true` (use `&` if the URL already has query parameters). This requires encryption and accepts the template's generated certificate without verifying its identity.

To run locally against Railway, set the same app connection string in the gitignored `.env.local`. JSON data stays in the local file when you switch backends.

To seed the hosted demo, run `IGLOO_ORIGIN=https://your-app.example npm run seed` with the hosted database configured. This replaces only the `campus-coffee` project and rotates its private links.

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
- Private agent links and update POSTs, MCP, and the demo seed.
- PostgreSQL storage and shared rate limits when `DATABASE_URL` is configured.

**Next:** Provision Railway and deploy to Vercel, then check the public app and agent endpoints. See the plan for follow-up features.

Rules: never call any AI or LLM API, and add files and dependencies only when they're needed.
