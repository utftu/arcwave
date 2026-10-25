import { beforeAll, describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { integer, pgSchema, text } from "drizzle-orm/pg-core";
import {
  createAccountsTable,
  createSessionsTable,
  createUsersTable,
} from "../../db/schema.ts";
import type { Account, AuthCore } from "../../core.ts";
import { saveAccount, saveAccountWithUser, saveUser } from "./db.ts";
import { createSession, deleteSession, getSessionUser } from "./session.ts";
import { createStage2Handler } from "./stage2.ts";

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
    await db.execute(`CREATE SCHEMA arcwave`);

    await db.execute(`
      CREATE TABLE arcwave.users (
        id text PRIMARY KEY,
        email text NOT NULL,
        name text NOT NULL,
        avatar_url text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await db.execute(
      `CREATE UNIQUE INDEX users_email_idx ON arcwave.users (email)`,
    );

    await db.execute(`
      CREATE TABLE arcwave.accounts (
        id text PRIMARY KEY,
        user_id text NOT NULL REFERENCES arcwave.users(id),
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
      `CREATE UNIQUE INDEX accounts_provider_account_id_idx
         ON arcwave.accounts (provider, provider_account_id)`,
    );

    await db.execute(`
      CREATE TABLE arcwave.sessions (
        id text PRIMARY KEY,
        user_id text NOT NULL REFERENCES arcwave.users(id),
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

    expect(account.account.provider).toBe("google");
    expect(account.account.providerAccountId).toBe("google-1");
    expect(account.account.userId).toBeTruthy();
    expect(account.created).toBe(true);
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

    expect(second.account.id).toBe(first.account.id);
    expect(second.account.name).toBe("Second Updated");
    expect(second.account.avatarUrl).toBe("https://img");
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
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

    expect(github.account.userId).toBe(google.account.userId);
    // The app user row already existed, the second provider only linked to it.
    expect(google.created).toBe(true);
    expect(github.created).toBe(false);
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
      userId: account.account.userId,
    });

    const user = await getSessionUser({
      db,
      sessionsTable: sessions,
      usersTable: users,
      sessionId,
    });
    expect(user?.id).toBe(account.account.userId);

    const expiredSessionId = await createSession({
      db,
      sessionsTable: sessions,
      userId: account.account.userId,
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

// The point of this block is the transaction arcwave hands to a custom
// `saveUser`: a mock can't show that an app row and the user row land (or don't
// land) together, only a real database can.
describe("integration: createStage2Handler with a custom saveUser (PGlite)", () => {
  const db = drizzle();

  const users = createUsersTable();
  const accounts = createAccountsTable({ usersTable: users });
  const sessions = createSessionsTable({ usersTable: users });

  // An app-owned satellite table — the FK is what makes it prove the step runs
  // inside the same transaction as the user row.
  const limits = pgSchema("arcwave").table("limits", {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id),
    requests: integer("requests").notNull(),
  });

  function createAuth(account: Account): AuthCore {
    return {
      createUrl: () => new URL("https://provider.example.com/authorize"),
      getToken: async () => ({
        access_token: "at",
        token_type: "bearer",
        nonce: "nonce-1",
      }),
      getUser: async () => account,
    } as unknown as AuthCore;
  }

  function createRequest(redirectCookie?: string): Request {
    const cookies = [
      "arcwave_state=state-1",
      "arcwave_verifier=verifier-1",
      "arcwave_nonce=nonce-1",
    ];
    if (redirectCookie) {
      cookies.push(`arcwave_redirect=${encodeURIComponent(redirectCookie)}`);
    }

    return new Request("https://app.example.com/callback?code=c&state=state-1", {
      headers: { cookie: cookies.join("; ") },
    });
  }

  async function login(opts: {
    account: Account;
    saveUser?: Parameters<typeof createStage2Handler>[0]["saveUser"];
    afterLogin?: Parameters<typeof createStage2Handler>[0]["afterLogin"];
    onError?: (message: string) => void;
    redirectCookie?: string;
  }): Promise<Response> {
    const handler = createStage2Handler({
      provider: "google",
      providers: { google: createAuth(opts.account) },
      db,
      accountsTable: accounts,
      usersTable: users,
      sessionsTable: sessions,
      redirect: "/",
      onError: opts.onError,
      saveUser: opts.saveUser,
      afterLogin: opts.afterLogin,
    });

    return (await handler({
      req: createRequest(opts.redirectCookie),
    } as any)) as Response;
  }

  function getSessionId(response: Response): string | undefined {
    const cookie = response.headers.get("set-cookie");
    return cookie?.match(/arcwave_session=([^;]+)/)?.[1];
  }

  beforeAll(async () => {
    await db.execute(`CREATE SCHEMA arcwave`);
    await db.execute(`
      CREATE TABLE arcwave.users (
        id text PRIMARY KEY,
        email text NOT NULL,
        name text NOT NULL,
        avatar_url text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await db.execute(
      `CREATE UNIQUE INDEX users_email_idx ON arcwave.users (email)`,
    );
    await db.execute(`
      CREATE TABLE arcwave.accounts (
        id text PRIMARY KEY,
        user_id text NOT NULL REFERENCES arcwave.users(id),
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
      `CREATE UNIQUE INDEX accounts_provider_account_id_idx
         ON arcwave.accounts (provider, provider_account_id)`,
    );
    await db.execute(`
      CREATE TABLE arcwave.sessions (
        id text PRIMARY KEY,
        user_id text NOT NULL REFERENCES arcwave.users(id),
        expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await db.execute(`
      CREATE TABLE arcwave.limits (
        user_id text PRIMARY KEY REFERENCES arcwave.users(id),
        requests integer NOT NULL
      )
    `);
  });

  test("without the parameter the flow saves user, account and session", async () => {
    const account: Account = {
      id: "google-default",
      email: "default@example.com",
      name: "Default",
      avatarUrl: null,
      raw: {},
    };

    const response = await login({ account });
    expect(response.status).toBe(302);

    const user = await getSessionUser({
      db,
      sessionsTable: sessions,
      usersTable: users,
      sessionId: getSessionId(response)!,
    });
    expect(user?.email).toBe(account.email);
  });

  test("the redirect cookie wins over the handler's own redirect", async () => {
    const account: Account = {
      id: "google-redirect",
      email: "redirect@example.com",
      name: "Redirect",
      avatarUrl: null,
      raw: {},
    };

    const response = await login({
      account,
      redirectCookie: "/dashboard?tab=1",
    });

    expect(response.headers.get("location")).toBe("/dashboard?tab=1");
    // The cookie is single-use: cleared together with the rest of the flow.
    expect(
      response.headers
        .getSetCookie()
        .some((cookie) => cookie.startsWith("arcwave_redirect=;")),
    ).toBe(true);
  });

  test("a custom saveUser writes its own rows in the same transaction", async () => {
    const account: Account = {
      id: "google-custom",
      email: "custom@example.com",
      name: "Custom",
      avatarUrl: null,
      raw: {},
    };

    const response = await login({
      account,
      saveUser: ({ db: connection, account: found, provider }) =>
        connection.transaction(async (tx) => {
          const { userId, created } = await saveUser({
            db: tx,
            usersTable: users,
            account: found,
          });

          await tx
            .insert(limits)
            .values({ userId, requests: 100 })
            .onConflictDoNothing();

          const saved = await saveAccount({
            db: tx,
            accountsTable: accounts,
            provider,
            account: found,
            userId,
          });

          return { account: saved, created };
        }),
    });
    expect(response.status).toBe(302);

    const user = await getSessionUser({
      db,
      sessionsTable: sessions,
      usersTable: users,
      sessionId: getSessionId(response)!,
    });
    expect(user?.email).toBe(account.email);

    const [limit] = await db
      .select()
      .from(limits)
      .where(eq(limits.userId, user!.id));
    expect(limit?.requests).toBe(100);
  });

  test("a throwing saveUser leaves no user, account or session behind", async () => {
    const account: Account = {
      id: "google-rollback",
      email: "rollback@example.com",
      name: "Rollback",
      avatarUrl: null,
      raw: {},
    };

    const errors: string[] = [];
    const response = await login({
      account,
      onError: (message) => errors.push(message),
      saveUser: ({ db: connection, account: found }) =>
        connection.transaction(async (tx) => {
          await saveUser({ db: tx, usersTable: users, account: found });
          throw new Error("app step failed");
        }),
    });

    expect(response.status).toBe(500);
    expect(errors[0]).toContain("app step failed");

    const [row] = (
      await db.execute(sql`
        SELECT
          (SELECT count(*) FROM arcwave.users WHERE email = ${account.email})
          + (SELECT count(*) FROM arcwave.accounts WHERE provider_account_id = ${account.id})
          + (SELECT count(*) FROM arcwave.sessions s
               JOIN arcwave.users u ON u.id = s.user_id
               WHERE u.email = ${account.email}) AS count
      `)
    ).rows as { count: string }[];
    expect(Number(row?.count)).toBe(0);
  });
});

describe("integration: afterLogin (PGlite)", () => {
  const db = drizzle();

  const users = createUsersTable();
  const accounts = createAccountsTable({ usersTable: users });
  const sessions = createSessionsTable({ usersTable: users });

  function createAuth(account: Account): AuthCore {
    return {
      createUrl: () => new URL("https://provider.example.com/authorize"),
      getToken: async () => ({
        access_token: "at",
        token_type: "bearer",
        nonce: "nonce-1",
      }),
      getUser: async () => account,
    } as unknown as AuthCore;
  }

  async function login(opts: {
    account: Account;
    afterLogin?: Parameters<typeof createStage2Handler>[0]["afterLogin"];
    onError?: (message: string) => void;
  }): Promise<Response> {
    const handler = createStage2Handler({
      provider: "google",
      providers: { google: createAuth(opts.account) },
      db,
      accountsTable: accounts,
      usersTable: users,
      sessionsTable: sessions,
      redirect: "/",
      onError: opts.onError,
      afterLogin: opts.afterLogin,
    });

    const req = new Request(
      "https://app.example.com/callback?code=c&state=state-1",
      {
        headers: {
          cookie:
            "arcwave_state=state-1; arcwave_verifier=verifier-1; arcwave_nonce=nonce-1",
        },
      },
    );

    return (await handler({ req } as any)) as Response;
  }

  beforeAll(async () => {
    await db.execute(`CREATE SCHEMA arcwave`);
    await db.execute(`
      CREATE TABLE arcwave.users (
        id text PRIMARY KEY,
        email text NOT NULL,
        name text NOT NULL,
        avatar_url text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await db.execute(
      `CREATE UNIQUE INDEX users_email_idx ON arcwave.users (email)`,
    );
    await db.execute(`
      CREATE TABLE arcwave.accounts (
        id text PRIMARY KEY,
        user_id text NOT NULL REFERENCES arcwave.users(id),
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
      `CREATE UNIQUE INDEX accounts_provider_account_id_idx
         ON arcwave.accounts (provider, provider_account_id)`,
    );
    await db.execute(`
      CREATE TABLE arcwave.sessions (
        id text PRIMARY KEY,
        user_id text NOT NULL REFERENCES arcwave.users(id),
        expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
  });

  test("runs with a live session and reports created on the first login only", async () => {
    const account: Account = {
      id: "google-after",
      email: "after@example.com",
      name: "After",
      avatarUrl: null,
      raw: {},
    };

    const calls: { created: boolean; sessionId: string; userId: string }[] = [];
    const afterLogin: Parameters<typeof createStage2Handler>[0]["afterLogin"] = ({
      created,
      sessionId,
      savedAccount,
    }) => {
      calls.push({ created, sessionId, userId: savedAccount.userId });
    };

    await login({ account, afterLogin });
    await login({ account, afterLogin });

    expect(calls.map((call) => call.created)).toEqual([true, false]);
    expect(calls[0]!.userId).toBe(calls[1]!.userId);

    // The session the hook was told about is already usable.
    const user = await getSessionUser({
      db,
      sessionsTable: sessions,
      usersTable: users,
      sessionId: calls[0]!.sessionId,
    });
    expect(user?.email).toBe(account.email);
  });

  test("a failing hook reports through onError and still logs the person in", async () => {
    const account: Account = {
      id: "google-after-fail",
      email: "after-fail@example.com",
      name: "After Fail",
      avatarUrl: null,
      raw: {},
    };

    const errors: string[] = [];
    const response = await login({
      account,
      onError: (message) => errors.push(message),
      afterLogin: async () => {
        throw new Error("mailer down");
      },
    });

    expect(response.status).toBe(302);
    expect(errors[0]).toContain("mailer down");

    const sessionId = response.headers
      .get("set-cookie")
      ?.match(/arcwave_session=([^;]+)/)?.[1];
    const user = await getSessionUser({
      db,
      sessionsTable: sessions,
      usersTable: users,
      sessionId: sessionId!,
    });
    expect(user?.email).toBe(account.email);
  });
});
