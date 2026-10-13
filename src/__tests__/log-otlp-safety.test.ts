import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LoggerProvider,
  type LogRecordProcessor,
  type SdkLogRecord,
} from "@opentelemetry/sdk-logs";
import { logLineSink, ScopedLogRecordProcessor } from "../log-otlp.js";
import { createLogger } from "../logger.js";
import { forwardLogLine, setLogLineSink } from "../log-sink.js";
import { buildInstrumentations } from "../instrumentations.js";
import { capture, exporting, LOG_SCOPE } from "./log-otlp-helpers.js";

afterEach(() => setLogLineSink(undefined));

describe("OTLP log export safety", () => {
  // WHY: an exporter failure is logged as an otel_diag line; exporting that line would feed the
  // failing exporter its own failures, once per batch, forever.
  it("does not export OTel's own diagnostics", async () => {
    const { records } = exporting();
    const logger = createLogger(() => "api", capture().stream);
    logger.child({ component: "telemetry" }).error({ event: "otel_diag" }, "export failed");
    expect(await records()).toHaveLength(0);
  });

  // WHY: the boot and health lines tell an operator from Loki whether telemetry is running.
  it("exports the telemetry package's other lines", async () => {
    const { records } = exporting();
    const logger = createLogger(() => "api", capture().stream).child({ component: "telemetry" });
    logger.info({ event: "telemetry_started" }, "telemetry_started");
    logger.warn({ event: "telemetry_start_failed" }, "telemetry_start_failed");
    expect((await records()).map((r) => r.attributes.event)).toEqual([
      "telemetry_started",
      "telemetry_start_failed",
    ]);
  });

  // WHY: an instrumentation that emits its own records (a raw exception message and stack) must
  // never reach the exporter around the scrubbing logger.
  it("exports no record from a logger scope other than backbone", async () => {
    const { provider, records } = exporting();
    provider.getLogger("@opentelemetry/instrumentation-runtime-node").emit({
      body: "uncaught jane@example.com",
      attributes: { "exception.message": "jane@example.com" },
    });
    expect(await records()).toHaveLength(0);
  });

  it("keeps the runtime instrumentation's uncaught-exception capture off", () => {
    const runtime = buildInstrumentations([]).find(
      (i) => i.instrumentationName === "@opentelemetry/instrumentation-runtime-node",
    );
    expect(runtime?.getConfig()).toMatchObject({ captureUncaughtException: false });
  });

  // WHY: a sink that logs (an SDK diagnostic raised while exporting) must not recurse into itself.
  it("does not re-enter the sink for a line logged while the sink runs", () => {
    const seen: string[] = [];
    const out = capture();
    const logger = createLogger(() => "api", out.stream);
    setLogLineSink((line) => {
      seen.push(line);
      logger.warn("logged while exporting");
    });
    logger.info("outer");
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain('"msg":"outer"');
    expect(out.lines).toHaveLength(2);
  });

  it("never throws into the caller when the sink throws, and still writes the line", () => {
    setLogLineSink(() => {
      throw new Error("exporter down");
    });
    const out = capture();
    const logger = createLogger(() => "api", out.stream);
    expect(() => logger.info("still logged")).not.toThrow();
    expect(out.lines).toHaveLength(1);
  });

  it("returns the line unchanged whether or not a sink is installed", () => {
    expect(forwardLogLine("x\n")).toBe("x\n");
    setLogLineSink(() => undefined);
    expect(forwardLogLine("x\n")).toBe("x\n");
  });

  // WHY: an SDK diagnostic raised while emitting a record must follow the line it is about.
  it("emits the record after the line is written, never inside the log call", async () => {
    const out = capture();
    const logger = createLogger(() => "api", out.stream);
    let reported = false;
    const noting: LogRecordProcessor = {
      onEmit: () => {
        if (reported) return;
        reported = true;
        logger.warn({ event: "sdk_note" }, "about the record");
      },
      forceFlush: () => Promise.resolve(),
      shutdown: () => Promise.resolve(),
    };
    const provider = new LoggerProvider({ processors: [noting] });
    setLogLineSink(logLineSink(provider.getLogger(LOG_SCOPE)));
    logger.info("the line");
    expect(reported).toBe(false);
    await Promise.resolve();
    expect(out.lines.map((l) => (JSON.parse(l) as { msg: string }).msg)).toEqual([
      "the line",
      "about the record",
    ]);
  });

  it("drops another scope's record in onEmit even when enabled() is bypassed", () => {
    const inner = { onEmit: vi.fn(), forceFlush: vi.fn(), shutdown: vi.fn() };
    const scoped = new ScopedLogRecordProcessor(inner as unknown as LogRecordProcessor, LOG_SCOPE);
    const record = (name: string) => ({ instrumentationScope: { name } }) as SdkLogRecord;
    scoped.onEmit(record("@opentelemetry/instrumentation-runtime-node"));
    expect(inner.onEmit).not.toHaveBeenCalled();
    scoped.onEmit(record("backbone"));
    expect(inner.onEmit).toHaveBeenCalledTimes(1);
  });
});
