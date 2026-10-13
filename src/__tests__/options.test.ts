import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InstrumentationBase } from "@opentelemetry/instrumentation";
import { installFatalHandlers } from "../fatal.js";
import { buildInstrumentations } from "../instrumentations.js";
import { isSensitiveKey, resetSensitiveKeys } from "../log-redact.js";
import { resetOptions } from "../options.js";
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
