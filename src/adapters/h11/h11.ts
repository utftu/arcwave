export { createStage1Handler } from "./stage1.ts";
export { clearAuthCookies, createStage2Handler } from "./stage2.ts";
export type { AfterLogin, SaveUserStep } from "./stage2.ts";
export { createAuthGuard } from "./guard.ts";
export { checkRedirectLocal } from "./redirect.ts";
export type { CheckRedirect } from "./redirect.ts";
export { createLogoutHandler } from "./logout.ts";
export { createSession, deleteSession, getSessionUser } from "./session.ts";
export type { Providers } from "./types.ts";
export { saveAccount, saveAccountWithUser, saveUser } from "./db.ts";
export type { Db, SavedAccount } from "./db.ts";
export type { Account } from "../../core.ts";
export {
  createAccountsTable,
  createSessionsTable,
  createUsersTable,
} from "../../db/schema.ts";
export type {
  AccountDB,
  AccountsTable,
  SessionDB,
  SessionsTable,
  UserBD,
  UsersTable,
} from "../../db/schema.ts";
