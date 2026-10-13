import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InstrumentationBase } from "@opentelemetry/instrumentation";
import { log as telemetryLog } from "../log-safely.js";
import { scrubAttributes } from "../redact.js";
import { EXEMPT_ATTRIBUTES } from "../app-keys.js";
import { installFatalHandlers } from "../fatal.js";
import { buildInstrumentations } from "../instrumentations.js";
import { isSensitiveKey, resetSensitiveKeys } from "../log-redact.js";
import { logScope, resetOptions } from "../options.js";
import { shutdownTelemetry, startTelemetry } from "../sdk.js";
import { log } from "../shared-log.js";
import { createTestLogger } from "../testing.js";

class AppInstrumentation extends InstrumentationBase {
  constructor() {
    super("app-instrumentation", "1.0.0", {});
  }
  protected init() {
    return [];
  }
}

afterEach(async () => {
  await shutdownTelemetry(100);
  resetOptions();
  resetSensitiveKeys();
  vi.restoreAllMocks();
});

describe("redactKeys", () => {
  // WHY: an app logs its own PII fields under names the default patterns cannot know.
  it("redacts an app key in any letter case on top of the defaults", async () => {
    await startTelemetry({ serviceName: "api", env: {}, redactKeys: ["unitLabel"] });
    const { logger, records } = createTestLogger();
    logger.info({ unitLabel: "4B", UNITLABEL: "4C", ssn: "123-45-6789", queue: "q" }, "x");
    expect(records[0]).toMatchObject({
      unitLabel: "[redacted]",
      UNITLABEL: "[redacted]",
      ssn: "[redacted]",
      queue: "q",
    });
  });

  it("never removes a default key", async () => {
    await startTelemetry({ serviceName: "api", env: {}, redactKeys: ["unitLabel"] });
    expect(isSensitiveKey("email")).toBe(true);
    expect(isSensitiveKey("taxId")).toBe(true);
  });
});

describe("instrumentations", () => {
  it("appends the app's instrumentations to the package's own list", () => {
    const app = new AppInstrumentation();
    const names = buildInstrumentations([], [app]).map((i) => i.instrumentationName);
    expect(names).toEqual([
      "@opentelemetry/instrumentation-runtime-node",
      "@opentelemetry/instrumentation-http",
      "@opentelemetry/instrumentation-undici",
      "@opentelemetry/instrumentation-ioredis",
      "@opentelemetry/instrumentation-pg",
      "app-instrumentation",
    ]);
  });
});

describe("onError", () => {
  function crash(): Error {
    const target = new EventEmitter();
    vi.spyOn(log, "fatal").mockImplementation(() => undefined);
    installFatalHandlers({
      target: target as unknown as Pick<NodeJS.Process, "on">,
      exit: () => undefined,
    });
    const err = new Error("boom");
    target.emit("uncaughtException", err);
    process.exitCode = undefined;
    return err;
  }

  // WHY: the app's error tracker (PostHog in Backbone) must see a crash even though the package
  // knows nothing about it.
  it("receives a fatal error, with the service name, when no report is given", async () => {
    const onError = vi.fn();
    await startTelemetry({ serviceName: "api", env: {}, onError });
    const err = crash();
    expect(onError).toHaveBeenCalledWith(err, { service: "api" });
  });

  it("never breaks the fatal path when it throws", async () => {
    await startTelemetry({
      serviceName: "api",
      env: {},
      onError: () => {
        throw new Error("tracker down");
      },
    });
    expect(() => crash()).not.toThrow();
  });
});

describe("a second startTelemetry call", () => {
  // WHY: stdout redaction and error reporting must not differ between a local run (no endpoint)
  // and a deployed one: the first call's options win in both.
  it("keeps the first call's options, and warns, with export off", async () => {
    const warn = vi.spyOn(telemetryLog, "warn").mockImplementation(() => undefined);
    await startTelemetry({ serviceName: "api", env: {}, redactKeys: ["unitLabel"] });
    await startTelemetry({ serviceName: "api", env: {}, redactKeys: ["roomCode"] });
    expect(isSensitiveKey("unitLabel")).toBe(true);
    expect(isSensitiveKey("roomCode")).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "telemetry_restart_ignored" }),
      "telemetry_restart_ignored",
    );
  });

  it("does not warn when the same options are passed again", async () => {
    const warn = vi.spyOn(telemetryLog, "warn").mockImplementation(() => undefined);
    const options = { serviceName: "api", env: {}, redactKeys: ["unitLabel"] };
    await startTelemetry(options);
    await startTelemetry({ ...options, redactKeys: ["unitLabel"] });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("startTelemetry with bad options", () => {
  // WHY: an untyped caller can pass anything; telemetry must never break the app's boot, and one
  // bad key must not cost the app every good one.
  it("keeps the valid redact keys and warns with only a bad entry's type", async () => {
    const warn = vi.spyOn(telemetryLog, "warn").mockImplementation(() => undefined);
    await expect(
      startTelemetry({
        serviceName: "api",
        env: {},
        redactKeys: ["unitLabel", 4111111111111111, { secret: "hunter2" }] as unknown as string[],
      }),
    ).resolves.toMatchObject({ enabled: false });
    expect(isSensitiveKey("unitLabel")).toBe(true);
    const calls = warn.mock.calls.filter(
      ([fields]) => (fields as { event?: string }).event === "invalid_redact_key",
    );
    expect(calls).toEqual([
      [{ event: "invalid_redact_key", types: ["number", "object"] }, "invalid_redact_key"],
    ]);
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/hunter2|4111111111111111/);
  });

  it("leaves no option applied when a call cannot be read, and a later call applies in full", async () => {
    const warn = vi.spyOn(telemetryLog, "warn").mockImplementation(() => undefined);
    await expect(
      startTelemetry({
        serviceName: "api",
        env: {},
        logScope: "half",
        redactKeys: ["roomCode"],
        onError: 5 as unknown as () => void,
      }),
    ).resolves.toMatchObject({ enabled: false });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "telemetry_start_failed" }),
      "telemetry_start_failed",
    );
    expect(logScope()).not.toBe("half");
    expect(isSensitiveKey("roomCode")).toBe(false);

    await startTelemetry({ serviceName: "api", env: {}, logScope: "acp", redactKeys: ["unitLabel"] });
    expect(logScope()).toBe("acp");
    expect(isSensitiveKey("unitLabel")).toBe(true);
    expect(warn).not.toHaveBeenCalledWith(
      expect.objectContaining({ event: "telemetry_restart_ignored" }),
      expect.anything(),
    );
  });

  it("resolves for options that are not an object", async () => {
    vi.spyOn(telemetryLog, "warn").mockImplementation(() => undefined);
    await expect(startTelemetry(null as never)).resolves.toMatchObject({ enabled: false });
  });
});

describe("redactKeys on spans", () => {
  // WHY: an app's PII key must not leave on a span attribute either. The agent's layer-2 scrub
  // does not know app keys, so layer 1 is the only place they are redacted.
  it("redacts a span attribute named by an app key, whole or as its last segment", async () => {
    await startTelemetry({ serviceName: "api", env: {}, redactKeys: ["unitLabel"] });
    expect(
      scrubAttributes({ unitLabel: "4B", "acp.unit_label": "x", "acp.UNITLABEL": "4C", queue: "q" }),
    ).toEqual({ unitLabel: "[redacted]", "acp.unit_label": "x", "acp.UNITLABEL": "[redacted]", queue: "q" });
  });

  // WHY: a generic app key (a bare `name` for a person's name) must not wipe the OpenTelemetry
  // attributes that traces are searched and grouped by.
  it("keeps the listed semantic-convention attributes from a generic key", async () => {
    await startTelemetry({
      serviceName: "api",
      env: {},
      redactKeys: ["name", "route", "method", "id", "type"],
    });
    const kept = {
      "db.system.name": "postgresql",
      "http.route": "/v1/tenants/:id",
      "http.request.method": "GET",
      "messaging.destination.name": "late-fees",
      "bullmq.job.id": "42",
      "error.type": "TimeoutError",
      "exception.type": "Error",
    };
    expect(scrubAttributes({ ...kept, "acp.tenant.name": "Jane", name: "Jane" })).toEqual({
      ...kept,
      "acp.tenant.name": "[redacted]",
      name: "[redacted]",
    });
  });

  it("keeps every listed attribute from keys built from their own last segments", async () => {
    const keys = [...EXEMPT_ATTRIBUTES].map((name) => name.slice(name.lastIndexOf(".") + 1));
    await startTelemetry({ serviceName: "api", env: {}, redactKeys: keys });
    const attributes = Object.fromEntries([...EXEMPT_ATTRIBUTES].map((name) => [name, "v"]));
    expect(scrubAttributes(attributes)).toEqual(attributes);
  });

  // WHY: an attribute the app sets under an OpenTelemetry namespace is still the app's data; only
  // the exact names the instrumentations emit are exempt.
  it("redacts an unlisted attribute under an OpenTelemetry namespace", async () => {
    await startTelemetry({ serviceName: "api", env: {}, redactKeys: ["unitLabel", "name"] });
    expect(
      scrubAttributes({
        "http.unitLabel": "4B",
        "db.unitlabel": "4B",
        "messaging.unitLabel": "4B",
        "bullmq.job.tenant.name": "Jane",
        "db.system.name": "postgresql",
      }),
    ).toEqual({
      "http.unitLabel": "[redacted]",
      "db.unitlabel": "[redacted]",
      "messaging.unitLabel": "[redacted]",
      "bullmq.job.tenant.name": "[redacted]",
      "db.system.name": "postgresql",
    });
  });

  // Prisma sets bare `name`, `method` and `model`; a whole-name app key matches them.
  it("redacts Prisma's bare attributes under a whole-name key", async () => {
    await startTelemetry({ serviceName: "api", env: {}, redactKeys: ["name", "model"] });
    expect(scrubAttributes({ name: "Tenant.findMany", model: "Tenant", method: "findMany" })).toEqual(
      { name: "[redacted]", model: "[redacted]", method: "findMany" },
    );
  });

  it("leaves span attributes alone when the app sets no keys", () => {
    expect(scrubAttributes({ unitLabel: "4B" })).toEqual({ unitLabel: "4B" });
  });
});
