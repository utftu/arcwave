import { getCookie, type Handler, type DataModule } from "h11";
import type { SessionsTable, UserBD, UsersTable } from "../../db/schema.ts";
import { COOKIE_SESSION } from "./const.ts";
import type { Db } from "./db.ts";
import { addRedirectParam } from "./redirect.ts";
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
  // The page the person asked for travels to the login route as `?redirect=`,
  // so stage1 can keep it for the way back.
  const unauthorized = (req: Request) => {
    if (!redirectTo) {
      return createReponse("Unauthorized", 401);
    }

    const target = new URL(req.url);
    return createRedirect(
      addRedirectParam(redirectTo, `${target.pathname}${target.search}`),
    );
  };

  return async (ctx) => {
    const sessionId = getCookie(ctx.req, COOKIE_SESSION);
    if (!sessionId) {
      return unauthorized(ctx.req);
    }

    const user = await getSessionUser({
      db,
      sessionsTable,
      usersTable,
      sessionId,
    });
    if (!user) {
      return unauthorized(ctx.req);
    }

    ctx.data.user = user;
  };
}
