import { Pool, type PoolClient } from "pg";
import type { Activity, Decision, Member, Note, Project, ProjectFile, Task } from "./core";

export type StoredFile = ProjectFile & { data?: string };
export type StoredMember = Member & { device_code_hash?: string | null; device_expires_at?: string | null };
const fileColumns = "id, project_id, task_id, member_id, name, kind, size, created_at";

export type DB = {
  projects: Project[]; members: StoredMember[]; tasks: Task[];
  decisions: Decision[]; notes: Note[]; activity: Activity[]; project_files: StoredFile[]; seq: number;
};
export const empty = (): DB => ({ projects: [], members: [], tasks: [], decisions: [], notes: [], activity: [], project_files: [], seq: 0 });

export type Selector = { slug: string } | { projectId: string } | { agentToken: string };
let pool: Pool | undefined;

export function postgres() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 3,
      connectionTimeoutMillis: 5000,
      allowExitOnIdle: true,
    });
    pool.on("error", (err) => console.error("Idle PostgreSQL connection failed", err.name));
  }
  return pool;
}

function projectFilter(by: Selector) {
  if ("slug" in by) return { where: "p.slug = $1", value: by.slug };
  if ("projectId" in by) return { where: "p.id = $1", value: by.projectId };
  return { where: "p.id = (SELECT project_id FROM members WHERE agent_token = $1)", value: by.agentToken };
}

const tables = {
  projects: "id, slug, name, course_or_context, due_date, brief, join_code, created_at",
  members: "id, project_id, name, ai_tool, color, last_seen_at, agent_token, session_token, device_code_hash, device_expires_at",
  tasks: "id, project_id, title, phase, position, due_date, owner_member_id, status, claimed_at, done_at",
  decisions: "id, project_id, text, created_by, approved_by, created_at",
  notes: "id, project_id, text, source_member_id, created_at",
  project_files: fileColumns,
} as const;

export async function loadSession(slug: string, token: string): Promise<Member | null> {
  const { rows } = await postgres().query<{ member: Member }>(`
    SELECT row_to_json(m) AS member FROM members m
    JOIN projects p ON p.id = m.project_id
    WHERE p.slug = $1 AND m.session_token = $2
  `, [slug, token]);
  return rows[0]?.member ?? null;
}

export async function loadActivityId(slug: string): Promise<number> {
  const { rows } = await postgres().query<{ id: number }>(`
    SELECT a.id::double precision AS id FROM activity a
    JOIN projects p ON p.id = a.project_id
    WHERE p.slug = $1 ORDER BY a.id DESC LIMIT 1
  `, [slug]);
  return rows[0]?.id ?? 0;
}

export async function loadProject(by: Selector, client: Pool | PoolClient = postgres()): Promise<DB> {
  const { where, value } = projectFilter(by);
  const { rows } = await client.query<Omit<DB, "seq">>(`
    SELECT json_build_array(p) AS projects,
      ARRAY(SELECT row_to_json(m) FROM (
        SELECT ${tables.members} FROM members WHERE project_id = p.id ORDER BY join_order
      ) m) AS members,
      ARRAY(SELECT row_to_json(t) FROM tasks t WHERE t.project_id = p.id ORDER BY t.position) AS tasks,
      ARRAY(SELECT row_to_json(d) FROM decisions d WHERE d.project_id = p.id ORDER BY d.created_at, d.id) AS decisions,
      ARRAY(SELECT row_to_json(n) FROM (
        SELECT * FROM notes WHERE project_id = p.id ORDER BY created_at DESC, id DESC LIMIT 15
      ) n ORDER BY n.created_at, n.id) AS notes,
      ARRAY(SELECT row_to_json(a) FROM (
        SELECT * FROM activity WHERE project_id = p.id ORDER BY id DESC LIMIT 60
      ) a ORDER BY a.id) AS activity,
      ARRAY(SELECT row_to_json(f) FROM (
        SELECT ${fileColumns} FROM project_files WHERE project_id = p.id ORDER BY created_at, id
      ) f) AS project_files
    FROM projects p WHERE ${where}
  `, [value]);
  return rows[0] ? { ...rows[0], seq: rows[0].activity.at(-1)?.id ?? 0 } : empty();
}

// Persist only rows changed by the shared rules. The project lock covers the read,
// validation and all writes, including the corresponding activity rows.
async function saveProject(client: PoolClient, before: DB, after: DB) {
  if (before.projects.length && !after.projects.length) {
    await client.query("DELETE FROM projects WHERE id = $1", [before.projects[0].id]);
    return;
  }
  for (const table of Object.keys(tables) as (keyof typeof tables)[]) {
    const prior = new Map(before[table].map((row) => [row.id, row]));
    const columns = tables[table];
    for (const row of after[table]) {
      const previous = prior.get(row.id);
      const payload = JSON.stringify(row);
      if (!previous) {
        const insertColumns = table === "project_files" ? `${columns}, data` : columns;
        await client.query(`
          INSERT INTO ${table} (${insertColumns})
          SELECT ${insertColumns} FROM jsonb_populate_record(NULL::${table}, $1)
        `, [payload]);
      } else if (JSON.stringify(previous) !== payload) {
        const changed = columns.split(", ").slice(1).join(", ");
        const claiming = "owner_member_id" in row && "owner_member_id" in previous &&
          previous.owner_member_id === null && row.owner_member_id !== null;
        const result = await client.query(`
          UPDATE ${table} SET (${changed}) = (
            SELECT ${changed} FROM jsonb_populate_record(NULL::${table}, $1)
          ) WHERE id = $2 ${claiming ? "AND project_id = $3 AND owner_member_id IS NULL" : ""}
        `, claiming ? [payload, row.id, row.project_id] : [payload, row.id]);
        if (result.rowCount !== 1) throw new Error("Project changed during write");
      }
    }
  }
  const entries = after.activity.filter((row) => row.id > before.seq);
  if (entries.length) {
    await client.query(`
      INSERT INTO activity (project_id, member_id, kind, message, created_at)
      SELECT project_id, member_id, kind, message, created_at
      FROM jsonb_populate_recordset(NULL::activity, $1)
      ORDER BY id
    `, [JSON.stringify(entries)]);
  }
}

export async function loadFileBytes(projectId: string, id: string) {
  const { rows } = await postgres().query<{ file: ProjectFile & { data: string } }>(
    "SELECT row_to_json(f) AS file FROM project_files f WHERE project_id = $1 AND id = $2",
    [projectId, id],
  );
  return rows[0]?.file;
}

export async function projectTransaction<T>(by: Selector, apply: (db: DB) => T): Promise<T> {
  return transaction(async (client) => {
    // A slug can be created before a project row exists.
    if ("slug" in by) await client.query("SELECT pg_advisory_xact_lock(1, hashtext($1))", [by.slug]);
    const { where, value } = projectFilter(by);
    await client.query(`SELECT p.id FROM projects p WHERE ${where} FOR UPDATE`, [value]);
    const before = await loadProject(by, client);
    const after = structuredClone(before);
    const result = apply(after);
    await saveProject(client, before, after);
    return result;
  });
}

export async function transaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await postgres().connect();
  let discard = false;
  try {
    await client.query("BEGIN");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch { discard = true; }
    throw err;
  } finally {
    client.release(discard);
  }
}

export async function recordRateHit(key: string, max: number, windowMs: number) {
  // All configured windows are at most one hour. Sweep expired keys occasionally.
  if (Math.random() < 0.01) {
    await postgres().query("DELETE FROM rate_hits WHERE at <= statement_timestamp() - interval '1 hour'");
  }
  return transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(2, hashtext($1))", [key]);
    const result = await client.query(`
      INSERT INTO rate_hits (key, at)
      SELECT $1, statement_timestamp()
      WHERE (
        SELECT count(*) FROM rate_hits
        WHERE key = $1 AND at > statement_timestamp() - $3 * interval '1 millisecond'
      ) < $2
    `, [key, max, windowMs]);
    return result.rowCount === 1;
  });
}
