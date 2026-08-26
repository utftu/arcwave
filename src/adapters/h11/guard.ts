import { getCookie, type Handler, type DataModule } from "h11";
import type { SessionsTable, UserBD, UsersTable } from "../../db/schema.ts";
import { COOKIE_SESSION } from "./const.ts";
import type { Db } from "./db.ts";
import { getSessionUser } from "./session.ts";
import { createRedirect, createReponse } from "./utils.ts";

export function createAuthGuard({
  db,
  sessionsTable,
  usersTable,
  redirectTo,
}: {
  db: Db;
  sessionsTable: SessionsTable;
  usersTable: UsersTable;
  redirectTo?: string;
}): DataModule<{ user: UserBD }> {
  const unauthorized = () =>
    redirectTo
      ? createRedirect(redirectTo)
      : createReponse("Unauthorized", 401);

  return async (ctx) => {
    const sessionId = getCookie(ctx.req, COOKIE_SESSION);
    if (!sessionId) {
      return unauthorized();
    }

    const user = await getSessionUser({
      db,
      sessionsTable,
      usersTable,
      sessionId,
    });
    if (!user) {
      return unauthorized();
    }

    ctx.data.user = user;
  };
}
