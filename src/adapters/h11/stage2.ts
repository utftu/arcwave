import { deleteCookie, getCookie, setCookie, type Handler } from "h11";
import type { Account } from "../../core.ts";
import type {
  AccountDB,
  AccountsTable,
  SessionsTable,
  UsersTable,
} from "../../db/schema.ts";
import {
  COOKIE_NONCE,
  COOKIE_REDIRECT,
  COOKIE_SESSION,
  COOKIE_STATE,
  COOKIE_VERIFIER,
  SESSION_COOKIE_OPTIONS,
} from "./const.ts";
import { saveAccountWithUser, type Db, type SavedAccount } from "./db.ts";
import { createSession } from "./session.ts";
import type { Providers } from "./types.ts";
import { createRedirect, createReponse, getAuth } from "./utils.ts";

// Replaces the step that writes the user and the account. The step owns its
// own transaction — that's how app rows become atomic with the user row, the
// same way the default `saveAccountWithUser` does it.
export type SaveUserStep = (props: {
  account: Account;
  provider: string;
  db: Db;
}) => Promise<SavedAccount>;

// Runs once the login has happened: the save step is committed, the session
// row exists. This is where side effects belong — welcome emails, analytics,
// calls to other services. A failure here is reported through `onError` and
// does not fail the login, which is the whole reason it isn't part of the save
// step.
export type AfterLogin = (props: {
  account: Account;
  provider: string;
  savedAccount: AccountDB;
  created: boolean;
  sessionId: string;
  db: Db;
}) => Promise<void> | void;

export function clearAuthCookies(response: Response): void {
  deleteCookie(response, COOKIE_STATE, { path: "/" });
  deleteCookie(response, COOKIE_NONCE, { path: "/" });
  deleteCookie(response, COOKIE_VERIFIER, { path: "/" });
  deleteCookie(response, COOKIE_REDIRECT, { path: "/" });
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
  saveUser,
  afterLogin,
}: {
  providers: Providers;
  provider: string;
  db: Db;
  accountsTable: AccountsTable;
  usersTable: UsersTable;
  sessionsTable: SessionsTable;
  redirect: string;
  onError?: (message: string) => void;
  saveUser?: SaveUserStep;
  afterLogin?: AfterLogin;
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

    let savedAccount: SavedAccount;
    try {
      if (saveUser) {
        savedAccount = await saveUser({ account, provider, db });
      } else {
        savedAccount = await saveAccountWithUser({
          db,
          accountsTable,
          usersTable,
          account,
          provider,
        });
      }
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
        userId: savedAccount.account.userId,
      });
    } catch (error) {
      onError?.(`failed to create session: ${error}`);
      const response = createReponse("Failed to create session.", 500);
      clearAuthCookies(response);
      return response;
    }

    if (afterLogin) {
      // The login already succeeded, so a failing side effect must not undo
      // it — it only goes to `onError`.
      await Promise.resolve(
        afterLogin({
          account,
          provider,
          savedAccount: savedAccount.account,
          created: savedAccount.created,
          sessionId,
          db,
        }),
      ).catch((error) => onError?.(`afterLogin failed: ${error}`));
    }

    const response = createRedirect(
      getCookie(ctx.req, COOKIE_REDIRECT) ?? redirect,
    );
    setCookie(response, COOKIE_SESSION, sessionId, SESSION_COOKIE_OPTIONS);
    clearAuthCookies(response);
    return response;
  };
}
