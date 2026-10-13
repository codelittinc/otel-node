import { describe, expect, it } from "vitest";
import { createTestLogger } from "../testing.js";

// A rethrown pg error: its `detail` and message carry the row values that failed.
function pgError(): Error {
  return Object.assign(new Error("duplicate key for jane@example.com"), {
    code: "23505",
    detail: "Key (email)=(jane@example.com) already exists PG-DETAIL",
    table: "Tenant",
  });
}

// Each value hides PII or provider text somewhere a format arg can carry it.
const CASES: [string, () => Record<string, unknown> | unknown[]][] = [
  ["a string under err", () => ({ tenantId: "t-1", err: "jane@example.com raw" })],
  [
    "an array of error-shaped objects under err",
    () => ({ tenantId: "t-1", err: [{ detail: "ARR-DETAIL", message: "a" }] }),
  ],
  ["an error under cause", () => ({ tenantId: "t-1", cause: pgError() })],
  ["an array holding an error", () => [{ tenantId: "t-1" }, pgError()]],
  ["an email under a key that is not PII", () => ({ tenantId: "t-1", user: "jane@example.com" })],
  ["a deep ssn key", () => ({ tenantId: "t-1", nested: { deep: { ssn: "123-45-6789" } } })],
  [
    "an email in a URL path",
    () => ({ tenantId: "t-1", url: new URL("https://x.io/residents/jane@example.com/statements") }),
  ],
  ["a mailto URL", () => ({ tenantId: "t-1", url: new URL("mailto:jane@example.com") })],
];
const LEAK = /jane@example\.com|123-45-6789|PG-DETAIL|ARR-DETAIL|"detail"/;

// Format args and the log object share one sanitizer, so the same value is safe in either place.
describe("format args are sanitized like the log object", () => {
  it.each(["%j", "%o"])("leaks nothing through a %s format arg", (fmt) => {
    for (const [, build] of CASES) {
      const { logger, records } = createTestLogger();
      const info = logger.info.bind(logger) as (msg: string, ...args: unknown[]) => void;
      info(`ctx ${fmt}`, build());
      const msg = String(records[0]!.msg);
      expect(msg).not.toMatch(LEAK);
      expect(msg).toContain("t-1");
    }
  });

  it.each(CASES.filter(([, build]) => !Array.isArray(build())))(
    "leaks nothing through the log object: %s",
    (_, build) => {
      const { logger, records } = createTestLogger();
      logger.info(build() as Record<string, unknown>, "ctx");
      expect(JSON.stringify(records[0])).not.toMatch(LEAK);
      expect(records[0]).toMatchObject({ tenantId: "t-1", msg: "ctx" });
    },
  );

  it("passes a primitive format arg through the same string scrub", () => {
    const { logger, records } = createTestLogger();
    logger.info("ctx %s %d", "jane@example.com", 42);
    expect(records[0]!.msg).toBe("ctx [redacted] 42");
  });

  it("keeps an error's code and scrubbed message in a format arg", () => {
    const { logger, records } = createTestLogger();
    logger.info("ctx %j", { err: pgError() });
    expect(String(records[0]!.msg)).toContain('"code":"23505"');
    expect(String(records[0]!.msg)).toContain('"message":"duplicate key for [redacted]"');
  });
});
