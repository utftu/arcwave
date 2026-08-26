import { deleteCookie, getCookie, setCookie, type Handler } from "h11";
import type { Account } from "../../core.ts";
import type { AccountsTable, SessionsTable, UsersTable } from "../../db/schema.ts";
import {
  COOKIE_NONCE,
  COOKIE_SESSION,
  COOKIE_STATE,
  COOKIE_VERIFIER,
  SESSION_COOKIE_OPTIONS,
} from "./const.ts";
import { saveAccountWithUser, type Db } from "./db.ts";
import { createSession } from "./session.ts";
import type { Providers } from "./types.ts";
import { createRedirect, createReponse, getAuth } from "./utils.ts";

export function clearAuthCookies(response: Response): void {
  deleteCookie(response, COOKIE_STATE, { path: "/" });
  deleteCookie(response, COOKIE_NONCE, { path: "/" });
  deleteCookie(response, COOKIE_VERIFIER, { path: "/" });
}

function checkConditions(req: Request) {
  const parsedUrl = new URL(req.url);

  if (parsedUrl.searchParams.get("error")) {
    return createReponse("Authorization was cancelled or denied", 400);
  }

  const code = parsedUrl.searchParams.get("code");
  if (!code) {
    return createReponse("Missing code", 400);
  }

  const state = parsedUrl.searchParams.get("state");
  if (!state || state !== getCookie(req, COOKIE_STATE)) {
    const response = createReponse("Invalid state", 400);
    clearAuthCookies(response);
    return response;
  }

  const verifier = getCookie(req, COOKIE_VERIFIER);
  if (!verifier) {
    const response = createReponse("Missing or expired auth session", 400);
    clearAuthCookies(response);
    return response;
  }

  const nonce = getCookie(req, COOKIE_NONCE);
  if (!nonce) {
    const response = createReponse("Missing or expired auth session", 400);
    clearAuthCookies(response);
    return response;
  }

  return { code, verifier, nonce };
}

export function createStage2Handler({
  provider,
  providers,
  db,
  accountsTable,
  usersTable,
  sessionsTable,
  redirect,
  onError,
}: {
  providers: Providers;
  provider: string;
  db: Db;
  accountsTable: AccountsTable;
  usersTable: UsersTable;
  sessionsTable: SessionsTable;
  redirect: string;
  onError?: (message: string) => void;
}): Handler {
  return async (ctx) => {
    const auth = getAuth(provider, providers);

    const data = checkConditions(ctx.req);
    if (data instanceof Response) {
      return data;
    }

    let token: Awaited<ReturnType<typeof auth.getToken>>;
    try {
      token = await auth.getToken({
        code: data.code,
        verifier: data.verifier,
        nonce: data.nonce,
      });
    } catch (error) {
      onError?.(`failed to exchange authorization code: ${error}`);
      const response = createReponse(
        "Failed to exchange authorization code.",
        400,
      );
      clearAuthCookies(response);
      return response;
    }

    let account: Account;
    try {
      account = await auth.getUser(token);
    } catch (error) {
      onError?.(`failed to get account info: ${error}`);
      const response = createReponse("Failed to get account info.", 400);
      clearAuthCookies(response);
      return response;
    }

    let savedAccount: Awaited<ReturnType<typeof saveAccountWithUser>>;
    try {
      savedAccount = await saveAccountWithUser({
        db,
        accountsTable,
        usersTable,
        account,
        provider,
      });
    } catch (error) {
      onError?.(`failed to save account: ${error}`);
      const response = createReponse("Failed to save account.", 500);
      clearAuthCookies(response);
      return response;
    }

    let sessionId: string;
    try {
      sessionId = await createSession({
        db,
        sessionsTable,
        userId: savedAccount.userId,
      });
    } catch (error) {
      onError?.(`failed to create session: ${error}`);
      const response = createReponse("Failed to create session.", 500);
      clearAuthCookies(response);
      return response;
    }

    const response = createRedirect(redirect);
    setCookie(response, COOKIE_SESSION, sessionId, SESSION_COOKIE_OPTIONS);
    clearAuthCookies(response);
    return response;
  };
}
