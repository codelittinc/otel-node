import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { context, ROOT_CONTEXT, trace, TraceFlags } from "@opentelemetry/api";
import { SeverityNumber } from "@opentelemetry/api-logs";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { createLogger } from "../logger.js";
import { hasLogLineSink, setLogLineSink } from "../log-sink.js";
import { logLineSink, NO_MESSAGE } from "../log-otlp.js";
import { capture, exporting, LOG_SCOPE } from "./log-otlp-helpers.js";

const PII = /jane@example\.com|123-45-6789|SENTINEL-PII|Jane|000123456789/;

beforeAll(() => {
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
});

afterEach(() => setLogLineSink(undefined));

describe("OTLP log export", () => {
  // WHY: the exporter must see only what the scrubbing logger writes, never the raw call.
  it("exports a record with no PII from the message, nested fields, error or query", async () => {
    const { records } = exporting();
    const logger = createLogger(() => "api", capture().stream);
    logger.error(
      {
        tenant: { firstName: "Jane", contact: { email: "jane@example.com" } },
        account: { accountNumber: "000123456789" },
        err: new Error("charge failed for jane@example.com ssn 123-45-6789"),
        url: new URL("https://api.test/v1/tenants?search=SENTINEL-PII"),
        path: "GET /v1/tenants?search=SENTINEL-PII",
      },
      "lookup for jane@example.com 123-45-6789 at /v1/tenants?search=SENTINEL-PII",
    );
    const [record] = await records();
    expect(record).toBeDefined();
    expect(JSON.stringify({ body: record!.body, attributes: record!.attributes })).not.toMatch(PII);
  });

  it("exports exactly the fields of the line the logger writes", async () => {
    const { records } = exporting();
    const out = capture();
    const logger = createLogger(() => "worker", out.stream);
    logger.child({ component: "jobs" }).warn({ jobId: "j-1", nested: { n: 1 } }, "job slow");
    const {
      msg,
      level,
      time: _time,
      ...rest
    } = JSON.parse(out.lines[0]!) as Record<string, unknown>;
    const [record] = await records();
    expect(record!.body).toBe(msg);
    expect(record!.severityText).toBe(level);
    expect(record!.attributes).toEqual(rest);
  });

  it.each([
    ["trace", SeverityNumber.TRACE],
    ["debug", SeverityNumber.DEBUG],
    ["info", SeverityNumber.INFO],
    ["warn", SeverityNumber.WARN],
    ["error", SeverityNumber.ERROR],
    ["fatal", SeverityNumber.FATAL],
  ] as const)("maps pino level %s to its OTel severity", async (level, severity) => {
    const { records } = exporting();
    const logger = createLogger(() => "api", capture().stream);
    logger.level = "trace";
    logger[level]("x");
    const [record] = await records();
    expect(record!.severityNumber).toBe(severity);
    expect(record!.severityText).toBe(level);
  });

  it("gives a level it does not know an unspecified severity, keeping its name", async () => {
    const { records, provider } = exporting();
    logLineSink(provider.getLogger(LOG_SCOPE))('{"level":"notice","msg":"x"}');
    const [record] = await records();
    expect(record!.severityNumber).toBe(SeverityNumber.UNSPECIFIED);
    expect(record!.severityText).toBe("notice");
  });

  // WHY: a record must be placed at the moment the line was logged, not when it was exported.
  it("takes the record time from the line's time field", async () => {
    const { records, provider } = exporting();
    logLineSink(provider.getLogger(LOG_SCOPE))(
      '{"level":"info","time":"2024-01-02T03:04:05.678Z","msg":"past"}',
    );
    const [record] = await records();
    expect(record!.hrTime).toEqual([
      Math.floor(Date.parse("2024-01-02T03:04:05.678Z") / 1000),
      678e6,
    ]);
  });

  it("uses event as the body of a line with no message, else a fixed marker", async () => {
    const { records } = exporting();
    const logger = createLogger(() => "api", capture().stream);
    logger.info({ event: "job_done" });
    logger.info({ jobId: "j-1" });
    const [withEvent, bare] = await records();
    expect(withEvent!.body).toBe("job_done");
    expect(bare!.body).toBe(NO_MESSAGE);
  });

  it("carries the active span's trace and span ids as the record context", async () => {
    const { records } = exporting();
    const logger = createLogger(() => "api", capture().stream);
    const spanContext = {
      traceId: "0af7651916cd43dd8448eb211c80319c",
      spanId: "b7ad6b7169203331",
      traceFlags: TraceFlags.SAMPLED,
    };
    context.with(trace.setSpanContext(ROOT_CONTEXT, spanContext), () => logger.info("inside"));
    const [record] = await records();
    expect(record!.spanContext).toMatchObject(spanContext);
    expect(record!.attributes).not.toHaveProperty("trace_id");
    expect(record!.attributes).not.toHaveProperty("span_id");
  });

  // WHY: a caller's own `trace_id` (a Stripe payout's) must not become the record's trace.
  it("keeps a caller's trace_id as a renamed attribute, never as the record context", async () => {
    const { records } = exporting();
    const logger = createLogger(() => "api", capture().stream);
    logger.info({ trace_id: "0af7651916cd43dd8448eb211c80319c", span_id: "b7ad6b7169203331" });
    const [record] = await records();
    expect(record!.spanContext).toBeUndefined();
    expect(record!.attributes).toMatchObject({
      "field.trace_id": "0af7651916cd43dd8448eb211c80319c",
      "field.span_id": "b7ad6b7169203331",
    });
  });

  // WHY: the SDK keeps a record's first 128 attributes, and the logger writes `app` last.
  it("keeps app, env, component and event on a 200-field line", async () => {
    const { records } = exporting();
    const logger = createLogger(() => "api", capture().stream).child({ component: "jobs" });
    const wide: Record<string, unknown> = {};
    for (let i = 0; i < 200; i++) wide[`f${i}`] = i;
    logger.info({ ...wide, event: "wide_line" }, "wide");
    const [record] = await records();
    expect(Object.keys(record!.attributes)).toHaveLength(128);
    expect(record!.attributes).toMatchObject({
      app: "api",
      env: expect.any(String),
      component: "jobs",
      event: "wide_line",
    });
  });

  it("writes byte-for-byte the same stdout line with and without export", () => {
    const app = () => "api";
    const plain = capture();
    createLogger(app, plain.stream).info({ a: 1 }, "same");
    exporting();
    const teed = capture();
    createLogger(app, teed.stream).info({ a: 1 }, "same");
    const strip = (line: string) => line.replace(/"time":"[^"]+"/, "");
    expect(strip(teed.lines[0]!)).toBe(strip(plain.lines[0]!));
  });

  it("installs no sink until the SDK boots one", () => {
    expect(hasLogLineSink()).toBe(false);
  });
});
