import { sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { Account } from "../../core.ts";
import type { AccountDB, AccountsTable, UsersTable } from "../../db/schema.ts";

export type Db = PgDatabase<any, any, any>;

// `created` tells whether the app user row was inserted by this login — the
// first login of this person overall, whatever provider they used. It comes
// from Postgres `xmax = 0`, which is only true for a row the current statement
// inserted, so an upsert that updated an existing row reports `false`.
export type SavedAccount = {
  account: AccountDB;
  created: boolean;
};

export async function saveAccount({
  db,
  accountsTable,
  provider,
  account,
  userId,
}: {
  db: Db;
  accountsTable: AccountsTable;
  provider: string;
  account: Account;
  userId: string;
}): Promise<AccountDB> {
  const [row] = await db
    .insert(accountsTable)
    .values({
      provider,
      providerAccountId: account.id,
      userId,
      email: account.email,
      name: account.name,
      avatarUrl: account.avatarUrl,
      raw: account.raw,
    })
    .onConflictDoUpdate({
      target: [accountsTable.provider, accountsTable.providerAccountId],
      set: {
        userId,
        email: account.email,
        name: account.name,
        avatarUrl: account.avatarUrl,
        raw: account.raw,
        updatedAt: new Date(),
      },
    })
    .returning();

  if (!row) {
    throw new Error("Failed to save account.");
  }

  return row;
}

export async function saveUser({
  db,
  usersTable,
  account,
}: {
  db: Db;
  usersTable: UsersTable;
  account: Account;
}): Promise<{ userId: string; created: boolean }> {
  const [user] = await db
    .insert(usersTable)
    .values({
      email: account.email,
      name: account.name,
      avatarUrl: account.avatarUrl,
    })
    .onConflictDoUpdate({
      target: usersTable.email,
      set: {
        name: account.name,
        avatarUrl: account.avatarUrl,
        updatedAt: new Date(),
      },
    })
    .returning({
      id: usersTable.id,
      created: sql<boolean>`xmax = 0`,
    });

  if (!user) {
    throw new Error("Failed to save user.");
  }

  return { userId: user.id, created: user.created };
}

export async function saveAccountWithUser({
  db,
  accountsTable,
  usersTable,
  provider,
  account,
}: {
  db: Db;
  accountsTable: AccountsTable;
  usersTable: UsersTable;
  provider: string;
  account: Account;
}): Promise<SavedAccount> {
  return db.transaction(async (tx) => {
    const { userId, created } = await saveUser({ db: tx, usersTable, account });
    const saved = await saveAccount({
      db: tx,
      accountsTable,
      provider,
      account,
      userId,
    });

    return { account: saved, created };
  });
}
