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

To open your existing membership on another browser, use **Copy rejoin link** on a browser where you’re already signed in. Open it on the new browser, or paste it into **I’m already in** on the join page. The private link expires after 10 minutes and works once.

## Deploy

The app and its database both run on Railway, in one project. The app talks to PostgreSQL over Railway's private network, so the database never needs to be reachable from the internet.

1. Create a Railway project and add a PostgreSQL service.
2. Add a service from this GitHub repo in the same project. Railway builds it with `npm run build` and starts it with `npm start`, which listens on the `PORT` Railway provides.
3. In the app service's variables, set `DATABASE_URL` to `${{Postgres.DATABASE_URL}}` (the private connection string). Never prefix it with `NEXT_PUBLIC_`.
4. Under the app service's **Networking**, generate a Railway domain or add your own.
5. Apply [db/schema.sql](db/schema.sql) once, and again whenever it changes (see "Working from your machine" below).

### Working from your machine

Your computer can't reach Railway's private network. To apply the schema, seed, or run locally against the hosted database, turn on [Public Access](https://docs.railway.com/databases/postgresql#connecting-externally) for the PostgreSQL service and use its `DATABASE_PUBLIC_URL`. You can turn it off again afterwards; the deployed app doesn't use it.

- **Schema:** with the public URL in your shell as `DATABASE_PUBLIC_URL`, run `PGSSLMODE=require psql "$DATABASE_PUBLIC_URL" -v ON_ERROR_STOP=1 -f db/schema.sql`.
- **Local app against Railway:** set `DATABASE_URL` in the gitignored `.env.local` to the public URL with `?sslmode=require&uselibpqcompat=true` appended (use `&` if the URL already has query parameters). This requires encryption and accepts the template's generated certificate without verifying its identity. JSON data stays in the local file when you switch backends.
- **Demo seed:** with that same `DATABASE_URL` set, run `IGLOO_ORIGIN=https://your-app.up.railway.app npm run seed`. This replaces only the `campus-coffee` project and rotates its private links.

Don't use JSON mode on Railway: the service's disk is reset on every deploy.

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

**Next:** Deploy the app and database on Railway, then check the public app and agent endpoints. See the plan for follow-up features.

Rules: never call any AI or LLM API, and add files and dependencies only when they're needed.
