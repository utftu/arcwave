import { and, eq, gt } from "drizzle-orm";
import type { SessionsTable, UserBD, UsersTable } from "../../db/schema.ts";
import type { Db } from "./db.ts";

const DEFAULT_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

export async function createSession({
  db,
  sessionsTable,
  userId,
  ttlMs = DEFAULT_TTL_MS,
}: {
  db: Db;
  sessionsTable: SessionsTable;
  userId: string;
  ttlMs?: number;
}): Promise<string> {
  const [session] = await db
    .insert(sessionsTable)
    .values({ userId, expiresAt: new Date(Date.now() + ttlMs) })
    .returning();

  if (!session) {
    throw new Error("Failed to create session.");
  }

  return session.id;
}

export async function getSessionUser({
  db,
  sessionsTable,
  usersTable,
  sessionId,
}: {
  db: Db;
  sessionsTable: SessionsTable;
  usersTable: UsersTable;
  sessionId: string;
}): Promise<UserBD | null> {
  const [row] = await db
    .select({ user: usersTable })
    .from(sessionsTable)
    .innerJoin(usersTable, eq(sessionsTable.userId, usersTable.id))
    .where(
      and(
        eq(sessionsTable.id, sessionId),
        gt(sessionsTable.expiresAt, new Date()),
      ),
    )
    .limit(1);

  return row?.user ?? null;
}

export async function deleteSession({
  db,
  sessionsTable,
  sessionId,
}: {
  db: Db;
  sessionsTable: SessionsTable;
  sessionId: string;
}): Promise<void> {
  await db.delete(sessionsTable).where(eq(sessionsTable.id, sessionId));
}
