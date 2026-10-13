import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { symbols } from "pino";
import type { Logger } from "pino";
import type * as SharedLogModule from "../shared-log.js";

type SharedLog = typeof SharedLogModule;

/** A fresh copy of the module, so each case starts with an unconfigured process. */
async function freshSharedLog(): Promise<SharedLog> {
  vi.resetModules();
  return import("../shared-log.js");
}

/** Points the shared logger at an in-memory stream; children created earlier write there too. */
function capture(log: Logger): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  (log as unknown as Record<symbol, unknown>)[symbols.streamSym] = {
    write: (line: string) => void records.push(JSON.parse(line) as Record<string, unknown>),
  };
  return records;
}

describe("the shared logger", () => {
  let mod: SharedLog;
  let records: Record<string, unknown>[];

  beforeEach(async () => {
    mod = await freshSharedLog();
    records = capture(mod.log);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("falls back to OTEL_SERVICE_NAME, then to unknown, until the process names itself", () => {
    vi.stubEnv("OTEL_SERVICE_NAME", "from-otel");
    mod.log.info("a");
    vi.stubEnv("OTEL_SERVICE_NAME", "");
    mod.log.info("b");
    expect(records.map((r) => r.app)).toEqual(["from-otel", "unknown"]);
  });

  // Module-scope children are created at import, before the entry point calls configureLogger.
  it("stamps the configured app on a child created before configuration", () => {
    const early = mod.log.child({ component: "early" });
    mod.configureLogger({ service: "worker" });
    early.info("after");
    expect(records[0]).toMatchObject({ app: "worker", component: "early" });
  });

  it("gives a package line both its component and the process app", () => {
    mod.configureLogger({ service: "api" });
    mod.log.child({ component: "db" }).warn({ tenantId: "t-1" }, "slow query");
    expect(records[0]).toMatchObject({
      app: "api",
      component: "db",
      tenantId: "t-1",
      msg: "slow query",
    });
  });

  it("keeps redacting child bindings", () => {
    mod.log.child({ component: "db", applicantEmail: "a@b.co" }).info("m");
    expect(JSON.stringify(records[0])).not.toContain("a@b.co");
  });

  // An imported module must not be able to rename the process after its entry point did.
  it("keeps the first service name and warns when a later call names another", () => {
    mod.configureLogger({ service: "api" });
    mod.configureLogger({ service: "api" });
    expect(records).toHaveLength(0);

    mod.configureLogger({ service: "mcp" });
    mod.log.info("x");
    expect(records[0]).toMatchObject({
      level: "warn",
      event: "logger_reconfigure_ignored",
      requested: "mcp",
      app: "api",
    });
    expect(records[1]).toMatchObject({ app: "api", msg: "x" });
  });
});

describe("an invalid LOG_LEVEL", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is reported when the process names itself, carrying the app", async () => {
    vi.stubEnv("LOG_LEVEL", "verbose");
    const mod = await freshSharedLog();
    const records = capture(mod.log);
    expect(records).toHaveLength(0);
    mod.configureLogger({ service: "mcp" });
    expect(records).toEqual([
      expect.objectContaining({ event: "invalid_log_level", requested: "verbose", app: "mcp" }),
    ]);
  });
});

describe("flushLog", () => {
  it("resolves when flushing throws", async () => {
    const mod = await freshSharedLog();
    const flush = vi.spyOn(mod.log, "flush").mockImplementation(() => {
      throw new Error("stream gone");
    });
    try {
      await expect(mod.flushLog(50)).resolves.toBeUndefined();
    } finally {
      flush.mockRestore();
    }
  });

  it("resolves after the timeout when the flush never calls back", async () => {
    const mod = await freshSharedLog();
    const flush = vi.spyOn(mod.log, "flush").mockImplementation(() => undefined);
    vi.useFakeTimers();
    try {
      const done = mod.flushLog(1_000);
      await vi.advanceTimersByTimeAsync(1_000);
      await expect(done).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
      flush.mockRestore();
    }
  });
});
