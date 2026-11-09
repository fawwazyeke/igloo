BEGIN;

CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  course_or_context text NOT NULL,
  due_date date,
  brief text NOT NULL,
  join_code text NOT NULL CHECK (join_code ~ '^[0-9]{6}$'),
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS members (
  id uuid PRIMARY KEY,
  join_order bigint GENERATED ALWAYS AS IDENTITY,
  project_id uuid NOT NULL REFERENCES projects ON DELETE CASCADE,
  name text NOT NULL,
  ai_tool text NOT NULL,
  color text NOT NULL,
  last_seen_at timestamptz NOT NULL,
  agent_token text NOT NULL UNIQUE CHECK (agent_token ~ '^[0-9a-f]{64}$'),
  session_token text NOT NULL UNIQUE CHECK (session_token ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS members_project_name ON members (project_id, lower(name));
ALTER TABLE members ADD COLUMN IF NOT EXISTS device_code_hash text;
ALTER TABLE members ADD COLUMN IF NOT EXISTS device_expires_at timestamptz;

CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects ON DELETE CASCADE,
  title text NOT NULL,
  phase text NOT NULL CHECK (phase IN ('research', 'build', 'present')),
  position integer NOT NULL,
  due_date date,
  owner_member_id uuid REFERENCES members,
  status text NOT NULL CHECK (status IN ('todo', 'doing', 'done')),
  claimed_at timestamptz,
  done_at timestamptz
);
CREATE INDEX IF NOT EXISTS tasks_project_position ON tasks (project_id, position);

CREATE TABLE IF NOT EXISTS decisions (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects ON DELETE CASCADE,
  text text NOT NULL,
  created_by uuid REFERENCES members,
  approved_by uuid REFERENCES members,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS decisions_project_created ON decisions (project_id, created_at);

CREATE TABLE IF NOT EXISTS notes (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects ON DELETE CASCADE,
  text text NOT NULL,
  source_member_id uuid REFERENCES members,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS notes_project_created ON notes (project_id, created_at);

CREATE TABLE IF NOT EXISTS activity (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects ON DELETE CASCADE,
  member_id uuid REFERENCES members,
  kind text NOT NULL,
  message text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS activity_project_id ON activity (project_id, id DESC);

CREATE TABLE IF NOT EXISTS rate_hits (
  key text NOT NULL,
  at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_hits_key_at ON rate_hits (key, at);
CREATE INDEX IF NOT EXISTS rate_hits_at ON rate_hits (at);

CREATE TABLE IF NOT EXISTS project_files (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects ON DELETE CASCADE,
  task_id uuid REFERENCES tasks ON DELETE SET NULL,
  member_id uuid NOT NULL REFERENCES members,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('text', 'pdf', 'slides', 'document')),
  size integer NOT NULL CHECK (size BETWEEN 1 AND 2097152),
  created_at timestamptz NOT NULL,
  data text NOT NULL
);
CREATE INDEX IF NOT EXISTS project_files_project_created ON project_files (project_id, created_at);
-- Shared links (GitHub, Canva…) live alongside files.
ALTER TABLE project_files ADD COLUMN IF NOT EXISTS url text;
ALTER TABLE project_files DROP CONSTRAINT IF EXISTS project_files_kind_check;
ALTER TABLE project_files ADD CONSTRAINT project_files_kind_check CHECK (kind IN ('text', 'pdf', 'slides', 'document', 'link'));

COMMIT;
