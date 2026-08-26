# arcwave

A small OAuth 2.0 / OIDC library for TypeScript. Built with [Bun](https://bun.sh).

## Design principle

arcwave does **not** unify providers at the protocol level — Google, GitHub,
etc. each keep their own request/response shapes (PKCE, OIDC id_tokens, plain
OAuth2, whatever they actually need). The only thing arcwave guarantees is a
single, unified result shape once a login succeeds:

```ts
type Account = {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  raw: unknown;
};
```

Everything provider-specific stays inside that provider's own module.

## Install

```sh
bun add arcwave drizzle-orm h11 h11-fs
```

(`h11-fs` is only needed if you use the `arcwave/h11` adapter — it's h11's
runtime provider, e.g. `h11-fs/bun` for `Bun.serve`.)

## Providers

```ts
import { google, github } from "arcwave";

const providers = {
  google: google({
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    redirectUri: "http://localhost:3000/auth/google/stage2",
    scope: ["openid", "email", "profile"],
  }),
  github: github({
    clientId: process.env.GITHUB_CLIENT_ID!,
    clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    redirectUri: "http://localhost:3000/auth/github/stage2",
    scope: ["read:user", "user:email"],
  }),
};
```

Both providers only ever return an `Account`. In every case `account.email`
is guaranteed to be a provider-verified email — Google requires
`email_verified: true` in the id_token, GitHub requires a `primary && verified`
entry from `/user/emails` — before `getUser` returns anything at all. This is
what makes automatic account linking by email (see below) safe.

## h11 adapter

`arcwave/h11` wires the OAuth flow into two route handlers for the
[h11](https://github.com) framework, plus a fixed, arcwave-owned Drizzle
schema for persistence.

```ts
import { H11 } from "h11";
import { createBunProvider } from "h11-fs/bun";
import {
  createStage1Handler,
  createStage2Handler,
  createAuthGuard,
  createAccountsTable,
  createUsersTable,
  createSessionsTable,
} from "arcwave/h11";
import { google } from "arcwave";
import { drizzle } from "drizzle-orm/bun-sql";

const providers = { google: google({ /* ... */ }) };
const db = drizzle(process.env.DATABASE_URL!);

const users = createUsersTable();
const accounts = createAccountsTable({ usersTable: users });
const sessions = createSessionsTable({ usersTable: users });

const h11 = new H11();

h11.get(
  "/auth/google/stage1",
  createStage1Handler({ provider: "google", providers }),
);

h11.get(
  "/auth/google/stage2",
  createStage2Handler({
    provider: "google",
    providers,
    db,
    accountsTable: accounts,
    usersTable: users,
    sessionsTable: sessions,
    redirect: "/",
    onError: (message) => console.error("[auth]", message),
  }),
);

h11.get(
  "/dashboard",
  createAuthGuard({ db, sessionsTable: sessions, usersTable: users, redirectTo: "/login" }),
  (ctx) => {
    const user = (ctx.data as { user?: { name: string } }).user;
    return new Response(`Welcome, ${user?.name}`);
  },
);

const provider = createBunProvider({ h11 });
Bun.serve({ port: 3000, fetch: (req, server) => provider(req, server) });
```

`createStage1Handler` starts the flow: generates `state`/`nonce`/PKCE
`verifier`+`challenge`, stores them in short-lived cookies, and redirects to
the provider's authorize URL.

`createStage2Handler` handles the callback: validates `state` (CSRF) and
`nonce` (id_token replay) against the cookies, exchanges the code for tokens,
fetches the account, upserts it into the database (`user` row matched/created
by verified email, `account` row upserted by `(provider, providerAccountId)`),
creates a session row, and sets the session cookie before redirecting.

`createAuthGuard` protects a route: reads the session cookie, looks the
session up in `arcwave_sessions` (rejecting expired ones), and either
attaches the matching `user` row to `ctx.data.user` and lets the chain
continue, or redirects to `redirectTo` if there's no valid session.

### Schema

arcwave owns a fixed schema (`arcwave_users`, `arcwave_accounts`,
`arcwave_sessions`) so you don't have to hand-write it, but **you** own the
Drizzle connection and migrations — arcwave has no driver dependency and
never touches `drizzle-kit` itself.

```ts
// your own app/db/schema.ts, pointed to by drizzle.config.ts
export const users = createUsersTable(); // optional: { schema, tableName }
export const accounts = createAccountsTable({ usersTable: users });
export const sessions = createSessionsTable({ usersTable: users });
```

Run migrations the normal way: `bunx drizzle-kit generate` / `migrate`.

Sessions are opaque bearer tokens stored server-side (not signed/stateless),
so revoking one is a plain delete — `deleteSession({ db, sessionsTable,
sessionId })` from `arcwave/h11` — e.g. for a logout route.

## Why arcwave links accounts by email automatically

Linking an OAuth identity to an app `user` by matching email is a known
account-takeover vector *if* the email isn't actually verified — an attacker
could register an unverified email with a weak provider and hijack an
existing account. arcwave avoids this by only ever calling `saveUser` with an
`account.email` that the provider itself already verified (see above), which
is the same mitigation used by libraries like Auth.js's
`allowDangerousEmailAccountLinking`, just enforced unconditionally rather than
left as a flag.

## Testing

```sh
bun test
```

## Status

- Providers: Google (OIDC), GitHub (OAuth2, no PKCE/nonce support on GitHub's
  side).
- No CI yet.
