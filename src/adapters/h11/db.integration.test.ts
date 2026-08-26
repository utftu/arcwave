import { beforeAll, describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/pglite";
import {
  createAccountsTable,
  createSessionsTable,
  createUsersTable,
} from "../../db/schema.ts";
import { saveAccountWithUser } from "./db.ts";
import { createSession, deleteSession, getSessionUser } from "./session.ts";

// PGlite is real Postgres compiled to WASM, running in-process — no Docker,
// no external server. Mocks can't verify ON CONFLICT upsert semantics, the
// FK-linked user/account/session join, or cross-provider linking by verified
// email, so this exercises those against the real thing instead.
describe("integration: saveAccountWithUser + sessions (PGlite)", () => {
  const db = drizzle();

  const users = createUsersTable();
  const accounts = createAccountsTable({ usersTable: users });
  const sessions = createSessionsTable({ usersTable: users });

  beforeAll(async () => {
    // Mirrors src/db/schema.ts's column definitions by hand — arcwave has no
    // driver/migration tooling of its own to generate this from the table
    // objects, so keep this in sync if the schema changes.
    await db.execute(`
      CREATE TABLE arcwave_users (
        id text PRIMARY KEY,
        email text NOT NULL,
        name text NOT NULL,
        avatar_url text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await db.execute(
      `CREATE UNIQUE INDEX arcwave_users_email_idx ON arcwave_users (email)`,
    );

    await db.execute(`
      CREATE TABLE arcwave_accounts (
        id text PRIMARY KEY,
        user_id text NOT NULL REFERENCES arcwave_users(id),
        provider text NOT NULL,
        provider_account_id text NOT NULL,
        email text NOT NULL,
        name text NOT NULL,
        avatar_url text,
        raw jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await db.execute(
      `CREATE UNIQUE INDEX arcwave_accounts_provider_account_id_idx
         ON arcwave_accounts (provider, provider_account_id)`,
    );

    await db.execute(`
      CREATE TABLE arcwave_sessions (
        id text PRIMARY KEY,
        user_id text NOT NULL REFERENCES arcwave_users(id),
        expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
  });

  test("creates a new user + account on first login", async () => {
    const account = await saveAccountWithUser({
      db,
      accountsTable: accounts,
      usersTable: users,
      provider: "google",
      account: {
        id: "google-1",
        email: "person@example.com",
        name: "Person",
        avatarUrl: null,
        raw: {},
      },
    });

    expect(account.provider).toBe("google");
    expect(account.providerAccountId).toBe("google-1");
    expect(account.userId).toBeTruthy();
  });

  test("logging in again with the same provider identity updates, not duplicates", async () => {
    const first = await saveAccountWithUser({
      db,
      accountsTable: accounts,
      usersTable: users,
      provider: "google",
      account: {
        id: "google-2",
        email: "second@example.com",
        name: "Second",
        avatarUrl: null,
        raw: {},
      },
    });

    const second = await saveAccountWithUser({
      db,
      accountsTable: accounts,
      usersTable: users,
      provider: "google",
      account: {
        id: "google-2",
        email: "second@example.com",
        name: "Second Updated",
        avatarUrl: "https://img",
        raw: {},
      },
    });

    expect(second.id).toBe(first.id);
    expect(second.name).toBe("Second Updated");
    expect(second.avatarUrl).toBe("https://img");
  });

  test("logging in via a different provider with the same verified email links to the same user", async () => {
    const google = await saveAccountWithUser({
      db,
      accountsTable: accounts,
      usersTable: users,
      provider: "google",
      account: {
        id: "google-3",
        email: "shared@example.com",
        name: "Shared",
        avatarUrl: null,
        raw: {},
      },
    });

    const github = await saveAccountWithUser({
      db,
      accountsTable: accounts,
      usersTable: users,
      provider: "github",
      account: {
        id: "github-3",
        email: "shared@example.com",
        name: "Shared",
        avatarUrl: null,
        raw: {},
      },
    });

    expect(github.userId).toBe(google.userId);
  });

  test("session round trip: create, look up, expire, delete", async () => {
    const account = await saveAccountWithUser({
      db,
      accountsTable: accounts,
      usersTable: users,
      provider: "google",
      account: {
        id: "google-4",
        email: "session@example.com",
        name: "Session",
        avatarUrl: null,
        raw: {},
      },
    });

    const sessionId = await createSession({
      db,
      sessionsTable: sessions,
      userId: account.userId,
    });

    const user = await getSessionUser({
      db,
      sessionsTable: sessions,
      usersTable: users,
      sessionId,
    });
    expect(user?.id).toBe(account.userId);

    const expiredSessionId = await createSession({
      db,
      sessionsTable: sessions,
      userId: account.userId,
      ttlMs: -1000,
    });
    const expiredUser = await getSessionUser({
      db,
      sessionsTable: sessions,
      usersTable: users,
      sessionId: expiredSessionId,
    });
    expect(expiredUser).toBeNull();

    await deleteSession({ db, sessionsTable: sessions, sessionId });
    const afterDelete = await getSessionUser({
      db,
      sessionsTable: sessions,
      usersTable: users,
      sessionId,
    });
    expect(afterDelete).toBeNull();
  });
});
