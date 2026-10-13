import { afterEach, describe, expect, it, vi } from "vitest";
import { context } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { BasicTracerProvider } from "@opentelemetry/sdk-trace-base";
import { announceLogLevel, createLogger, resolveLogLevel } from "../logger.js";
import { createTestLogger } from "../testing.js";

function capturing(): { lines: Record<string, unknown>[]; write: (l: string) => void } {
  const lines: Record<string, unknown>[] = [];
  return { lines, write: (l: string) => void lines.push(JSON.parse(l)) };
}

describe("thrown primitives", () => {
  it("scrubs a string logged as err", () => {
    const { logger, records } = createTestLogger();
    logger.error({ err: "jane@example.com 123-45-6789" }, "x");
    expect(JSON.stringify(records[0])).not.toMatch(/jane@example\.com|123-45-6789/);
  });
});

describe("createLogger", () => {
  afterEach(() => {
    context.disable();
    vi.unstubAllEnvs();
  });

  it("redacts PII at the top level and in nested objects", () => {
    const { logger, records } = createTestLogger();
    logger.info(
      {
        ssn: "123-45-6789",
        tenant: { accountNumber: "000123456789", email: "jane@example.com" },
        application: { applicant: { phone: "555-0100" } },
        req: { headers: { authorization: "Bearer abc", cookie: "sid=1" } },
        tenantId: "t-1",
      },
      "applied",
    );
    expect(JSON.stringify(records[0])).not.toMatch(
      /123-45-6789|000123456789|jane@example\.com|555-0100|Bearer abc|sid=1/,
    );
    expect(records[0]).toMatchObject({ level: "info", msg: "applied", tenantId: "t-1" });
  });

  it("stamps trace_id and span_id from the active span", () => {
    context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
    const tracer = new BasicTracerProvider().getTracer("t");
    const { logger, records } = createTestLogger();
    tracer.startActiveSpan("op", (span) => {
      logger.info("inside");
      span.end();
      expect(records[0]).toMatchObject({
        trace_id: span.spanContext().traceId,
        span_id: span.spanContext().spanId,
      });
    });
    logger.info("outside");
    expect(records[1]).not.toHaveProperty("trace_id");
  });

  describe("children", () => {
    it("redacts bindings and keeps chaining", () => {
      const { logger, records } = createTestLogger();
      const child = logger.child({ tenantId: "t-1", applicantEmail: "a@b.co" });
      child.child({ requestId: "r-1", nested: { ssn: "SENTINEL-G" } }).info("x");
      expect(records[0]).toMatchObject({ tenantId: "t-1", requestId: "r-1" });
      expect(JSON.stringify(records[0])).not.toMatch(/SENTINEL-G|a@b\.co/);
    });

    it("inherits level and accumulates msgPrefix in grandchildren", () => {
      const { logger, records } = createTestLogger();
      const a = logger.child({}, { level: "warn", msgPrefix: "[A] " });
      const b = a.child({}, { msgPrefix: "[B] " });
      b.info("dropped");
      b.warn("x");
      expect(records).toHaveLength(1);
      expect(records[0]!.msg).toBe("[A] [B] x");
    });
  });

  // Railway and the log search key on level, time, msg, app and env; a caller field of the same
  // name would overwrite the logger's value when the line is parsed.
  describe("reserved fields", () => {
    it("renames a caller's level, time, msg, app and env", () => {
      const { logger, records } = createTestLogger();
      logger.warn({ level: "L", time: "T", msg: "M", app: "A", env: "E", ok: 1 }, "real");
      expect(records[0]).toMatchObject({
        level: "warn",
        msg: "real",
        "field.level": "L",
        "field.time": "T",
        "field.msg": "M",
        "field.app": "A",
        "field.env": "E",
        ok: 1,
      });
      expect(records[0]!.time).not.toBe("T");
      expect(records[0]!.app).not.toBe("A");
    });

    it("renames reserved child bindings", () => {
      const { logger, records } = createTestLogger();
      logger.child({ level: "L", app: "A" }).info("x");
      expect(records[0]).toMatchObject({ level: "info", "field.level": "L", "field.app": "A" });
      expect(records[0]!.app).not.toBe("A");
    });
  });

  describe("msg", () => {
    const prismaErr = () =>
      Object.assign(new Error("Unique constraint failed: email=alice@example.com"), {
        name: "PrismaClientKnownRequestError",
        code: "P2002",
      });

    it("keeps raw error text out of msg when no message is given", () => {
      for (const call of [
        (l: ReturnType<typeof createTestLogger>["logger"]) => l.error(prismaErr()),
        (l: ReturnType<typeof createTestLogger>["logger"]) => l.error({ err: prismaErr() }),
        (l: ReturnType<typeof createTestLogger>["logger"]) => l.error({ error: prismaErr() }),
      ]) {
        const t = createTestLogger();
        call(t.logger);
        expect(JSON.stringify(t.records[0])).not.toContain("alice@example.com");
        expect(t.records[0]!.msg).toBe("PrismaClientKnownRequestError P2002");
      }
    });

    it("scrubs the msg pino derives from a non-Error err object", () => {
      const { logger, records } = createTestLogger();
      logger.error({ err: { message: "failed for jane@example.com", detail: "SENTINEL-D" } });
      expect(records[0]!.msg).toBe("failed for [redacted]");
      expect(JSON.stringify(records[0])).not.toMatch(/jane@example\.com|SENTINEL-D/);
    });

    it("scrubs a msg field", () => {
      const { logger, records } = createTestLogger();
      logger.info({ msg: "sent to jane@example.com", ok: 1 });
      expect(records[0]).toMatchObject({ msg: "sent to [redacted]", ok: 1 });
    });

    it("keeps a plain error's message as msg", () => {
      const { logger, records } = createTestLogger();
      logger.error(new Error("queue is down"));
      expect(records[0]!.msg).toBe("queue is down");
    });

    it("scrubs SSN and email shapes from msg but not other digits", () => {
      const { logger, records } = createTestLogger();
      logger.info("applicant 123-45-6789 mail bob@x.io amount 1234567890 id 000123456789");
      expect(records[0]!.msg).toBe(
        "applicant [redacted] mail [redacted] amount 1234567890 id 000123456789",
      );
    });

    it("redacts object format args and serializes Errors in them", () => {
      const { logger, records } = createTestLogger();
      const err = Object.assign(new Error("for jane@example.com"), { body: "SENTINEL-B" });
      logger.info("obj %j err %o", { email: "SENTINEL-F1", ok: 1 }, err);
      expect(JSON.stringify(records[0])).not.toMatch(/SENTINEL-F1|SENTINEL-B|jane@example\.com/);
      expect(records[0]!.msg).toContain('"ok":1');
    });

    // A format arg takes the log object's sanitizer, so an error under err/error/e is serialized.
    it.each(["%j", "%o"])("serializes err, error and e inside a %s format arg", (fmt) => {
      for (const key of ["err", "error", "e"]) {
        const err = Object.assign(new Error("m"), {
          body: "jane@example.com",
          command: { args: ["SECRET_ARG"] },
        });
        const { logger, records } = createTestLogger();
        if (fmt === "%j") logger.info("ctx %j", { [key]: err });
        else logger.info("ctx %o", { [key]: err });
        expect(JSON.stringify(records[0])).not.toMatch(/jane@example\.com|SECRET_ARG/);
      }
      // An error-shaped plain object (a rethrown pg error, a provider reply) is serialized too.
      const errorLike = {
        name: "X",
        message: "m to jane@example.com",
        body: "jane@example.com",
        detail: "SENT-DETAIL",
      };
      const { logger, records } = createTestLogger();
      if (fmt === "%j") logger.info("ctx %j", { err: errorLike });
      else logger.info("ctx %o", { err: errorLike });
      const msg = String(records[0]!.msg);
      expect(msg).not.toMatch(/jane@example\.com|SENT-DETAIL|"body"|"detail"/);
      expect(msg).toContain('"message":"m to [redacted]"');
    });

    it("scrubs a msg field that is renamed field.msg", () => {
      const { logger, records } = createTestLogger();
      logger.error({ err: new Error("boom"), msg: "user jane.doe@example.com" });
      logger.info({ msg: "user jane.doe@example.com" }, "real message");
      expect(records[0]).toMatchObject({ msg: "boom", "field.msg": "user [redacted]" });
      expect(records[1]).toMatchObject({ msg: "real message", "field.msg": "user [redacted]" });
    });

    it("serializes and scrubs Errors at any depth", () => {
      const { logger, records } = createTestLogger();
      const nested = Object.assign(new Error("for jane@example.com"), { command: "SENTINEL-N" });
      logger.error({ wrapped: { cause: nested }, list: [nested] }, "f");
      const line = JSON.stringify(records[0]);
      expect(line).not.toMatch(/jane@example\.com|SENTINEL-N/);
      expect(records[0]).toMatchObject({ wrapped: { cause: { message: "for [redacted]" } } });
    });
  });

  describe("caller input", () => {
    // A caller reuses its context object across calls; the logger's own fields must not leak in.
    it("leaves the caller's object unchanged", () => {
      const { logger } = createTestLogger();
      const ctx = { tenantId: "t-1" };
      const reserved = { tenantId: "t-1", level: "x" };
      logger.info(ctx, "m");
      logger.info(reserved, "m");
      expect(ctx).toEqual({ tenantId: "t-1" });
      expect(reserved).toEqual({ tenantId: "t-1", level: "x" });
    });

    // If the arguments cannot be inspected, nothing raw reaches msg: a format arg could carry PII.
    it("logs a placeholder with no format args when the arguments cannot be inspected", () => {
      const { logger, records } = createTestLogger();
      const hostile = {
        get msg(): string {
          throw new Error("no");
        },
      };
      const info = logger.info.bind(logger) as (o: object, m: string, ...a: unknown[]) => void;
      expect(() => info(hostile, "for %s", "jane@example.com")).not.toThrow();
      expect(records[0]!.msg).toBe("[unloggable]");
      expect(JSON.stringify(records[0])).not.toContain("jane@example.com");
    });
  });

  describe("LOG_LEVEL", () => {
    it("accepts any case and rejects silent, which would hide fatal lines", () => {
      expect(resolveLogLevel("DEBUG")).toEqual({ level: "debug" });
      expect(resolveLogLevel(" Warn ")).toEqual({ level: "warn" });
      expect(resolveLogLevel("silent")).toEqual({ level: "info", invalid: "silent" });
      expect(resolveLogLevel("bogus")).toEqual({ level: "info", invalid: "bogus" });
      expect(resolveLogLevel(undefined)).toEqual({ level: "info" });
    });

    // The warning waits for the process name, so it is searchable by app like every other line.
    it("holds the invalid-level warning until announced, then emits it once", () => {
      vi.stubEnv("LOG_LEVEL", "bogus");
      const { lines, write } = capturing();
      let app = "unknown";
      const logger = createLogger(() => app, { write });
      expect(lines).toHaveLength(0);
      app = "worker";
      announceLogLevel(logger);
      announceLogLevel(logger);
      logger.debug("hidden");
      logger.info("shown");
      expect(lines.map((l) => l.msg)).toEqual(["invalid LOG_LEVEL, using info", "shown"]);
      expect(lines[0]).toMatchObject({ level: "warn", requested: "bogus", app: "worker" });
    });

    it("emits the held warning before the first line when never announced", () => {
      vi.stubEnv("LOG_LEVEL", "silent");
      const { lines, write } = capturing();
      const logger = createLogger(() => "t", { write });
      logger.child({ component: "c" }).info("first");
      expect(lines.map((l) => l.msg)).toEqual(["invalid LOG_LEVEL, using info", "first"]);
    });
  });
});
