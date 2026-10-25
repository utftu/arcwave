export type CheckRedirect = RegExp | ((redirect: string) => boolean);

// Any fixed host works: it is only a marker. A value that carries its own host
// (`//evil.ru`, `https://evil.ru`, `/\evil.ru`, `/<tab>/evil.ru`) pushes the
// marker out when parsed, a plain path leaves it in place. The URL parser is
// asked because it also normalizes away tabs and backslashes, which is what
// makes hand-written string checks leak.
const PROBE_ORIGIN = "https://arcwave.invalid";

export function checkRedirectLocal(redirect: string): boolean {
  if (!redirect.startsWith("/")) {
    return false;
  }

  try {
    return new URL(redirect, PROBE_ORIGIN).origin === PROBE_ORIGIN;
  } catch {
    return false;
  }
}

export function createRedirectCheck(
  checkRedirect: CheckRedirect = checkRedirectLocal,
): (redirect: string) => boolean {
  if (checkRedirect instanceof RegExp) {
    return (redirect) => checkRedirect.test(redirect);
  }

  return checkRedirect;
}

export function addRedirectParam(redirectTo: string, from: string): string {
  const login = new URL(redirectTo, PROBE_ORIGIN);
  login.searchParams.set("redirect", from);

  // A relative `redirectTo` stays relative: building an absolute Location from
  // the request would bake in the `Host` header, which a proxy can rewrite.
  if (login.origin === PROBE_ORIGIN) {
    return `${login.pathname}${login.search}${login.hash}`;
  }

  return login.href;
}
