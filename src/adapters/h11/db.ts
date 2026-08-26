import type { PgDatabase } from "drizzle-orm/pg-core";
import type { Account } from "../../core.ts";
import type { AccountDB, AccountsTable, UsersTable } from "../../db/schema.ts";

export type Db = PgDatabase<any, any, any>;

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

async function saveUser({
  db,
  usersTable,
  account,
}: {
  db: Db;
  usersTable: UsersTable;
  account: Account;
}): Promise<string> {
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
    .returning();

  if (!user) {
    throw new Error("Failed to save user.");
  }

  return user.id;
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
}): Promise<AccountDB> {
  return db.transaction(async (tx) => {
    const userId = await saveUser({ db: tx, usersTable, account });
    return saveAccount({ db: tx, accountsTable, provider, account, userId });
  });
}
