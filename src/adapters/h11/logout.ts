import { deleteCookie, getCookie, type Handler } from "h11";
import type { SessionsTable } from "../../db/schema.ts";
import { COOKIE_SESSION } from "./const.ts";
import type { Db } from "./db.ts";
import { deleteSession } from "./session.ts";
import { createRedirect } from "./utils.ts";

export function createLogoutHandler({
  db,
  sessionsTable,
  redirect,
  onError,
}: {
  db: Db;
  sessionsTable: SessionsTable;
  redirect: string;
  onError?: (message: string) => void;
}): Handler {
  return async (ctx) => {
    const sessionId = getCookie(ctx.req, COOKIE_SESSION);
    if (sessionId) {
      try {
        await deleteSession({ db, sessionsTable, sessionId });
      } catch (error) {
        // Still log the user out client-side even if the DB delete failed —
        // an unreadable/stale session row shouldn't trap them in a logged-in UI.
        onError?.(`failed to delete session: ${error}`);
      }
    }

    const response = createRedirect(redirect);
    deleteCookie(response, COOKIE_SESSION, { path: "/" });
    return response;
  };
}
