import {
  type AnyPgColumn,
  jsonb,
  pgSchema,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { randomToken } from "../crypto/crypto.ts";

const usersTable = {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  email: text("email").notNull(),
  name: text("name").notNull(),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
};

export function createUsersTable(opts?: {
  schema?: string;
  tableName?: string;
}) {
  const tableName = opts?.tableName ?? "arcwave_users";

  if (opts?.schema) {
    return pgSchema(opts.schema).table(tableName, usersTable, (table) => [
      uniqueIndex(`${tableName}_email_idx`).on(table.email),
    ]);
  }

  return pgTable(tableName, usersTable, (table) => [
    uniqueIndex(`${tableName}_email_idx`).on(table.email),
  ]);
}

export type UsersTable = ReturnType<typeof createUsersTable>;
export type UserBD = UsersTable["$inferSelect"];

// `userId` links an identity to an application user, matched/created by
// verified email in `saveUser`. Safe only because providers are expected to
// guarantee `account.email` is verified before returning it (e.g.
// GoogleAuth.getUser throws on `email_verified: false`).
function createAccountsColumns(userIdRef: AnyPgColumn) {
  return {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => userIdRef),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    avatarUrl: text("avatar_url"),
    raw: jsonb("raw").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  };
}

export function createAccountsTable(opts: {
  schema?: string;
  tableName?: string;
  usersTable: UsersTable;
}) {
  const tableName = opts.tableName ?? "arcwave_accounts";
  const columns = createAccountsColumns(opts.usersTable.id);

  if (opts?.schema) {
    return pgSchema(opts.schema).table(tableName, columns, (table) => [
      uniqueIndex(`${tableName}_provider_account_id_idx`).on(
        table.provider,
        table.providerAccountId,
      ),
    ]);
  }

  return pgTable(tableName, columns, (table) => [
    uniqueIndex(`${tableName}_provider_account_id_idx`).on(
      table.provider,
      table.providerAccountId,
    ),
  ]);
}

export type AccountsTable = ReturnType<typeof createAccountsTable>;
export type AccountDB = AccountsTable["$inferSelect"];

function createSessionsColumns(userIdRef: AnyPgColumn) {
  return {
    // The session id doubles as the bearer token stored in the cookie —
    // `randomToken()` gives it 256 bits of CSPRNG entropy (vs. ~122 for a
    // v4 UUID) and it's already base64url, so it's cookie-safe as-is.
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomToken()),
    userId: text("user_id")
      .notNull()
      .references(() => userIdRef),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  };
}

export function createSessionsTable(opts: {
  schema?: string;
  tableName?: string;
  usersTable: UsersTable;
}) {
  const tableName = opts.tableName ?? "arcwave_sessions";
  const columns = createSessionsColumns(opts.usersTable.id);

  if (opts.schema) {
    return pgSchema(opts.schema).table(tableName, columns);
  }

  return pgTable(tableName, columns);
}

export type SessionsTable = ReturnType<typeof createSessionsTable>;
export type SessionDB = SessionsTable["$inferSelect"];
