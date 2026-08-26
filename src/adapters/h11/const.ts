export const COOKIE_STATE = "arcwave_state";
export const COOKIE_NONCE = "arcwave_nonce";
export const COOKIE_VERIFIER = "arcwave_verifier";
export const COOKIE_MAX_AGE = 600; // flow must complete within 10 minutes

export const COOKIE_OPTIONS = {
  path: "/",
  httpOnly: true,
  secure: true,
  sameSite: "Lax" as const,
  maxAge: COOKIE_MAX_AGE,
};

export const COOKIE_SESSION = "arcwave_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export const SESSION_COOKIE_OPTIONS = {
  path: "/",
  httpOnly: true,
  secure: true,
  sameSite: "Lax" as const,
  maxAge: SESSION_MAX_AGE,
};
