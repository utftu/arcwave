import { describe, expect, test } from "bun:test";
import {
  addRedirectParam,
  checkRedirectLocal,
  createRedirectCheck,
} from "./redirect.ts";

describe("checkRedirectLocal", () => {
  test("accepts local paths", () => {
    for (const redirect of [
      "/",
      "/dashboard",
      "/dashboard?tab=1&x=2",
      "/2fa",
      "/Admin",
      "/a%20b",
    ]) {
      expect(checkRedirectLocal(redirect)).toBe(true);
    }
  });

  test("rejects anything carrying a host of its own", () => {
    for (const redirect of [
      "//evil.ru/pwn",
      "https://evil.ru",
      "/\\evil.ru",
      // The URL parser drops tabs and newlines before parsing, which turns
      // this into `//evil.ru` — the case string checks leak on.
      "/\t/evil.ru",
      "/\n/evil.ru",
      "dashboard",
      "",
    ]) {
      expect(checkRedirectLocal(redirect)).toBe(false);
    }
  });
});

describe("createRedirectCheck", () => {
  test("defaults to checkRedirectLocal", () => {
    const check = createRedirectCheck();

    expect(check("/dashboard")).toBe(true);
    expect(check("//evil.ru")).toBe(false);
  });

  test("applies a RegExp with test()", () => {
    const check = createRedirectCheck(/^\/[a-z]/);

    expect(check("/dashboard")).toBe(true);
    expect(check("/2fa")).toBe(false);
  });

  test("uses a custom function as is", () => {
    const check = createRedirectCheck((redirect) => redirect === "/only");

    expect(check("/only")).toBe(true);
    expect(check("/other")).toBe(false);
  });
});

describe("addRedirectParam", () => {
  test("keeps a relative login path relative", () => {
    expect(addRedirectParam("/login", "/dashboard?tab=1")).toBe(
      "/login?redirect=%2Fdashboard%3Ftab%3D1",
    );
  });

  test("keeps an existing query on the login path", () => {
    expect(addRedirectParam("/login?from=nav", "/dashboard")).toBe(
      "/login?from=nav&redirect=%2Fdashboard",
    );
  });

  test("keeps an absolute login URL absolute", () => {
    expect(addRedirectParam("https://id.example.com/login", "/dashboard")).toBe(
      "https://id.example.com/login?redirect=%2Fdashboard",
    );
  });
});
