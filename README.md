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
[h11](https://github.com) framework. Persistence uses the arcwave-owned
Drizzle tables from `arcwave/schema`.

```ts
import { H11 } from "h11";
import { createBunProvider } from "h11-fs/bun";
import {
  createStage1Handler,
  createStage2Handler,
  createAuthGuard,
  createLogoutHandler,
} from "arcwave/h11";
import { google } from "arcwave";
import { drizzle } from "drizzle-orm/bun-sql";
import { accounts, sessions, users } from "./db/schema.ts"; // see "Schema" below

const providers = { google: google({ /* ... */ }) };
const db = drizzle(process.env.DATABASE_URL!);

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

// createAuthGuard must go through h11's `.use()`, not as an inline handler in
// `.get()` — only `.use()` widens the returned H11 instance's `TData` type so
// `ctx.data.user` type-checks (without a cast) on routes registered after it.
const protectedRoutes = h11.use(
  "/dashboard",
  createAuthGuard({ db, sessionsTable: sessions, usersTable: users, redirectTo: "/login" }),
);

protectedRoutes.get(
  "/dashboard",
  (ctx) => new Response(`Welcome, ${ctx.data.user.name}`),
);

h11.get(
  "/logout",
  createLogoutHandler({ db, sessionsTable: sessions, redirect: "/" }),
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
session up in `arcwave.sessions` (rejecting expired ones), and either
attaches the matching `user` row to `ctx.data.user` and lets the chain
continue, or responds with 401 — or, if `redirectTo` is given, redirects
there instead.

`createLogoutHandler` deletes the session row (best-effort — a DB failure
still clears the cookie so the user isn't stuck looking logged in) and
clears the session cookie.

### Schema

arcwave owns a fixed set of tables (`users`, `accounts`, `sessions`) in the
Postgres schema `arcwave`, so you don't have to hand-write them, but **you**
own the Drizzle connection and migrations — arcwave has no driver dependency
and never touches `drizzle-kit` itself.

Re-export the ready-made tables from your own schema file:

```ts
// app/db/schema.ts, pointed to by drizzle.config.ts
export { arcwaveSchema, users, accounts, sessions } from "arcwave/schema";

// ...your own tables
```

`drizzle-kit` loads that file and picks up every exported table and schema,
whatever the export is called. Exporting `arcwaveSchema` is what makes it emit
`CREATE SCHEMA "arcwave"` — without it the migration fails on a database that
doesn't have the schema yet.

`drizzle-kit push` / `pull` only look at `public` by default, so add the schema
to `drizzle.config.ts` (`generate` / `migrate` don't need it):

```ts
export default defineConfig({
  dialect: "postgresql",
  schema: "./app/db/schema.ts",
  schemaFilter: ["public", "arcwave"],
  // ...
});
```

Pass the same tables to the handlers:

```ts
import { accounts, sessions, users } from "./db/schema.ts";
```

#### Custom schema or table names

The factories behind the defaults are exported from `arcwave/schema` too
(and from `arcwave/h11`). Export your own `pgSchema` so `drizzle-kit` creates it:

```ts
import { pgSchema } from "drizzle-orm/pg-core";
import { createAccountsTable, createSessionsTable, createUsersTable } from "arcwave/schema";

export const authSchema = pgSchema("auth");
export const users = createUsersTable({ schema: "auth" }); // optional: tableName
export const accounts = createAccountsTable({ schema: "auth", usersTable: users });
export const sessions = createSessionsTable({ schema: "auth", usersTable: users });
```

With `schema: "public"` nothing needs to be exported, but the default names
`users` / `accounts` / `sessions` will likely clash with your own tables —
pass `tableName` too.

Run migrations the normal way: `bunx drizzle-kit generate` / `migrate`.

Sessions are opaque bearer tokens stored server-side (not signed/stateless),
so revoking one is a plain delete — see `createLogoutHandler` above, or call
`deleteSession({ db, sessionsTable, sessionId })` from `arcwave/h11` directly.

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

Most tests are unit-level (mocked `fetch`/`jose` for the providers, structural
checks for the schema). `src/adapters/h11/db.integration.test.ts` runs
against [PGlite](https://pglite.dev) — real Postgres compiled to WASM,
in-process, no server or Docker needed — to exercise things mocks can't:
`ON CONFLICT` upsert semantics, the FK-linked user/account/session join,
cross-provider linking by verified email. It runs as part of `bun test`
with no extra setup, locally and in CI.

## Building

```sh
bun run build
```

Bundles both entry points with `bun build` (`dist/arcwave.js`,
`dist/adapters/h11/h11.js`; `h11`/`drizzle-orm`/`jose` stay external, not
inlined) and emits matching `.d.ts` files via `tsc -p tsconfig.build.json`.
`dist` is gitignored — it's a build artifact, not committed source. The repo
ships TypeScript source (`src/`); `dist` only exists for what actually gets
published to npm.

## Releasing

Publishing to npm happens in CI, triggered by pushing a tag:

```sh
# bump "version" in package.json first, then:
git tag v0.1.0
git push --tags
```

`.github/workflows/publish.yml` re-runs the type check and full test suite,
runs `bun run build` (published tarball only ever contains `dist/`, never raw
`src/`), then `bun publish` (needs an `NPM_TOKEN` secret with publish rights
on the `arcwave` package). The tag is just the trigger — whatever version is
currently in `package.json` is what gets published, so bump it before
tagging.

If a tag push didn't result in a publish (e.g. the workflow failed), pushing
the same tag again requires deleting it first — git won't silently overwrite
an existing remote tag:

```sh
git tag -d v0.1.0
git push origin :refs/tags/v0.1.0
git tag v0.1.0
git push origin v0.1.0
```

## License

[MIT](./LICENSE)

## Status

- Providers: Google (OIDC), GitHub (OAuth2, no PKCE/nonce support on GitHub's
  side).
