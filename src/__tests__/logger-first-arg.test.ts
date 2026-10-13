import { describe, expect, it } from "vitest";
import { createTestLogger } from "../testing.js";

// The first argument is merged with the logger's own fields; it must reach the redactor in the
// shape JSON would give it, or a toJSON that hides a secret is bypassed.
describe("first-argument object", () => {
  it("honours a class's toJSON, so the fields it hides stay hidden", () => {
    class Credentials {
      privateKey = "SENTINEL-PK";
      keyId = "k-1";
      toJSON() {
        return { keyId: this.keyId };
      }
    }
    const { logger, records } = createTestLogger();
    logger.info(new Credentials(), "loaded");
    expect(JSON.stringify(records[0])).not.toContain("SENTINEL-PK");
    expect(records[0]).not.toHaveProperty("privateKey");
    expect(records[0]).toMatchObject({ keyId: "k-1", msg: "loaded" });
    expect(records[0]).toHaveProperty("app");
  });

  it("logs a Buffer as its length, not as indexed bytes", () => {
    const { logger, records } = createTestLogger();
    logger.info(Buffer.from("abc"), "m");
    expect(records[0]).toMatchObject({ bytes: 3, msg: "m" });
    expect(records[0]).not.toHaveProperty("0");
    expect(records[0]).toHaveProperty("app");
  });

  it("logs a URL under value as a scrubbed string without its query", () => {
    const { logger, records } = createTestLogger();
    logger.info(new URL("https://h.test/a/jane@example.com?token=SENTINEL-Q"), "m");
    expect(JSON.stringify(records[0])).not.toMatch(/jane@example\.com|SENTINEL-Q/);
    expect(records[0]).toMatchObject({ value: "https://h.test/a/[redacted]", msg: "m" });
    expect(records[0]).toHaveProperty("app");
  });

  it("converts before reading msg, so a msg property cannot bypass toJSON", () => {
    class Hide {
      privateKey = "SENTINEL-PK";
      msg = "hello";
      toJSON() {
        return { ok: 1 };
      }
    }
    const { logger, records } = createTestLogger();
    logger.info(new Hide(), "m");
    logger.info(new Hide());
    for (const record of records) expect(JSON.stringify(record)).not.toContain("SENTINEL-PK");
  });

  it("derives msg from an error that toJSON returns", () => {
    const { logger, records } = createTestLogger();
    logger.info({ toJSON: () => ({ err: new Error("") }) });
    expect(records[0]).toMatchObject({ msg: "Error" });
  });

  it("logs arrays, dates, typed arrays and maps the way JSON would see them", () => {
    const { logger, records } = createTestLogger();
    logger.info([1, "jane@example.com"], "a");
    logger.info(new Date(0), "d");
    logger.info(new Uint8Array([1, 2, 3]), "u");
    logger.info(new Map([["k", "v"]]), "m");
    expect(records[0]).toMatchObject({ value: [1, "[redacted]"] });
    expect(records[1]).toMatchObject({ value: "1970-01-01T00:00:00.000Z" });
    expect(records[2]).toMatchObject({ bytes: 3 });
    expect(records[2]).not.toHaveProperty("0");
    expect(records[3]).toMatchObject({ value: { k: "v" } });
  });

  it("never throws from child() when the bindings' toJSON throws", () => {
    const { logger, records } = createTestLogger();
    const bindings = {
      toJSON() {
        throw new Error("boom");
      },
    };
    expect(() => logger.child(bindings).info("c")).not.toThrow();
    expect(records[0]).toMatchObject({ log_redaction_failed: true, msg: "c" });
  });

  it("follows a toJSON chain only one level, so an endless chain cannot recurse", () => {
    class Chain {
      toJSON(): unknown {
        return new Chain();
      }
    }
    const { logger, records } = createTestLogger();
    expect(() => logger.info(new Chain(), "c")).not.toThrow();
    expect(() => logger.child(new Chain()).info("d")).not.toThrow();
    expect(records).toHaveLength(2);
  });

  it("keeps child bindings whose toJSON returns a date", () => {
    const { logger, records } = createTestLogger();
    logger.child({ toJSON: () => new Date(0) } as object).info("c");
    expect(records[0]).toMatchObject({ value: "1970-01-01T00:00:00.000Z" });
  });

  it("converts child bindings before renaming reserved keys", () => {
    const { logger, records } = createTestLogger();
    logger.child({ toJSON: () => ({ level: "x", app: "spoof" }) } as object).info("c");
    expect(records[0]).toMatchObject({ "field.level": "x", "field.app": "spoof" });
    expect(records[0]!.level).not.toBe("x");
  });
});

// An empty message would print `msg: ""`; the error type is the next most useful thing to search.
describe("an error with an empty message", () => {
  class LockLost extends Error {}

  it("falls back to the error type for msg", () => {
    for (const call of [
      (l: ReturnType<typeof createTestLogger>["logger"]) => l.error(new LockLost("")),
      (l: ReturnType<typeof createTestLogger>["logger"]) => l.error({ err: new LockLost("") }),
      (l: ReturnType<typeof createTestLogger>["logger"]) => l.error({ e: new LockLost("") }),
    ]) {
      const t = createTestLogger();
      call(t.logger);
      expect(t.records[0]!.msg).toBe("LockLost");
    }
  });

  it("keeps the caller's message when one is given", () => {
    const { logger, records } = createTestLogger();
    logger.error({ err: new LockLost("") }, "lock lost");
    expect(records[0]!.msg).toBe("lock lost");
  });
});
