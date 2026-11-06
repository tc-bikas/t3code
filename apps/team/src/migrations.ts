import type { Db } from "./db.ts";

// Append only: a released migration never changes. Migration 2 wipes the password-era dev data.
const MIGRATIONS: ReadonlyArray<string> = [
  `
  CREATE TABLE users (
    id text PRIMARY KEY,
    email text NOT NULL UNIQUE,
    name text NOT NULL,
    password_hash text NOT NULL,
    email_verified boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL
  );
  CREATE TABLE sessions (
    id text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash text NOT NULL UNIQUE,
    label text NOT NULL,
    created_at timestamptz NOT NULL,
    last_used_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL
  );
  CREATE INDEX sessions_user_idx ON sessions(user_id);
  CREATE TABLE email_tokens (
    token_hash text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind text NOT NULL,
    expires_at timestamptz NOT NULL,
    used_at timestamptz
  );
  CREATE INDEX email_tokens_user_idx ON email_tokens(user_id, kind);
  CREATE TABLE organizations (
    id text PRIMARY KEY,
    name text NOT NULL,
    auto_join_domain text UNIQUE,
    created_at timestamptz NOT NULL
  );
  CREATE TABLE memberships (
    org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role text NOT NULL,
    joined_at timestamptz NOT NULL,
    PRIMARY KEY (org_id, user_id)
  );
  CREATE INDEX memberships_user_idx ON memberships(user_id);
  CREATE TABLE invites (
    id text PRIMARY KEY,
    org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email text NOT NULL,
    role text NOT NULL,
    invited_by_name text NOT NULL,
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    UNIQUE (org_id, email)
  );
  CREATE INDEX invites_email_idx ON invites(email);
  `,
  `
  DROP TABLE IF EXISTS invites, memberships, organizations, email_tokens, sessions, users CASCADE;
  CREATE TABLE users (
    id text PRIMARY KEY,
    github_id bigint NOT NULL UNIQUE,
    github_login text NOT NULL,
    name text NOT NULL,
    avatar_url text,
    email text,
    created_at timestamptz NOT NULL
  );
  CREATE TABLE user_emails (
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email text NOT NULL,
    is_primary boolean NOT NULL DEFAULT false,
    PRIMARY KEY (user_id, email)
  );
  CREATE INDEX user_emails_email_idx ON user_emails(email);
  CREATE TABLE sessions (
    id text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash text NOT NULL UNIQUE,
    label text NOT NULL,
    created_at timestamptz NOT NULL,
    last_used_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL
  );
  CREATE INDEX sessions_user_idx ON sessions(user_id);
  CREATE TABLE github_sign_ins (
    state text PRIMARY KEY,
    code_verifier text NOT NULL,
    device_label text,
    expires_at timestamptz NOT NULL,
    callback_at timestamptz,
    error_message text,
    result_token text,
    result_expires_at timestamptz,
    result_user_id text
  );
  CREATE TABLE organizations (
    id text PRIMARY KEY,
    name text NOT NULL,
    auto_join_domain text UNIQUE,
    created_at timestamptz NOT NULL
  );
  CREATE TABLE memberships (
    org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role text NOT NULL,
    joined_at timestamptz NOT NULL,
    PRIMARY KEY (org_id, user_id)
  );
  CREATE INDEX memberships_user_idx ON memberships(user_id);
  CREATE TABLE invites (
    id text PRIMARY KEY,
    org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email text NOT NULL,
    role text NOT NULL,
    invited_by_name text NOT NULL,
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    UNIQUE (org_id, email)
  );
  CREATE INDEX invites_email_idx ON invites(email);
  `,
  `
  CREATE TABLE conversations (
    id uuid PRIMARY KEY,
    user_a text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_b text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    CHECK (user_a < user_b),
    UNIQUE (user_a, user_b)
  );
  CREATE INDEX conversations_user_b_idx ON conversations(user_b);
  CREATE TABLE messages (
    id bigserial PRIMARY KEY,
    conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body text NOT NULL,
    created_at timestamptz NOT NULL
  );
  CREATE INDEX messages_conversation_idx ON messages(conversation_id, id DESC);
  CREATE TABLE conversation_reads (
    conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_read_message_id bigint NOT NULL,
    PRIMARY KEY (conversation_id, user_id)
  );
  `,
  `
  ALTER TABLE messages
    ADD COLUMN reply_to_id bigint NULL REFERENCES messages(id) ON DELETE SET NULL,
    ADD COLUMN edited_at timestamptz NULL,
    ADD COLUMN deleted_at timestamptz NULL;
  CREATE TABLE message_reactions (
    message_id bigint NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji text NOT NULL,
    created_at timestamptz NOT NULL,
    seq bigserial NOT NULL,
    PRIMARY KEY (message_id, user_id, emoji)
  );
  CREATE INDEX message_reactions_message_idx ON message_reactions(message_id);
  `,
];

export async function migrate(db: Db): Promise<void> {
  await db.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  await db.transaction(async (tx) => {
    // Serialises concurrent instances starting against one database.
    await tx.query("LOCK TABLE schema_migrations IN EXCLUSIVE MODE");
    const applied = await tx.query<{ version: number }>("SELECT version FROM schema_migrations");
    const done = new Set(applied.map((row) => row.version));
    for (const [index, sql] of MIGRATIONS.entries()) {
      const version = index + 1;
      if (done.has(version)) continue;
      await tx.query(sql);
      await tx.query("INSERT INTO schema_migrations (version) VALUES ($1)", [version]);
    }
  });
}
