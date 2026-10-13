import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { inspect } from "node:util";
import { logs } from "@opentelemetry/api-logs";
import { captureConsole, releaseConsole } from "../console-capture.js";
import { log } from "../shared-log.js";
import { bootWithMemoryLogs, exported, flushLogs, stopTelemetry } from "./otlp-export-helpers.js";

vi.mock("@opentelemetry/exporter-logs-otlp-proto", async () =>
  (await import("./otlp-export-helpers.js")).memoryLogExporterModule(),
);

const written = { warn: vi.fn(), error: vi.fn() };
const original = { warn: console.warn, error: console.error };

beforeAll(async () => {
  console.warn = written.warn;
  console.error = written.error;
  // No logScope: the scope defaults to the service name.
  await bootWithMemoryLogs({ serviceName: "acp-api" });
  captureConsole();
  // The boot's own telemetry_started line.
  await flushLogs();
});

afterAll(async () => {
  releaseConsole();
  console.warn = original.warn;
  console.error = original.error;
  await stopTelemetry();
});

beforeEach(() => {
  exported.length = 0;
  written.warn.mockClear();
  written.error.mockClear();
});

function bodies(): unknown[] {
  return exported.map((record) => record.body);
}

describe("captureConsole", () => {
  // WHY: an app that logs with console must reach Loki without a rewrite, and stdout keeps the
  // line it always had.
  it("still writes the console line, unchanged", async () => {
    console.error("payout failed for", "acct");
    expect(written.error).toHaveBeenCalledWith("payout failed for", "acct");
    await flushLogs();
    expect(bodies()).toEqual(["payout failed for acct"]);
  });

  it("scrubs an SSN-shaped value before export", async () => {
    console.warn("screening returned 123-45-6789 for applicant");
    const records = await flushLogs();
    expect(records).toHaveLength(1);
    expect(JSON.stringify(records[0]!.body)).not.toContain("123-45-6789");
    expect(records[0]!.body).toBe("screening returned [redacted] for applicant");
    expect(records[0]!.severityText).toBe("warn");
  });

  it("redacts a PII key in an object it is given", async () => {
    console.error("lookup failed", { email: "jane@example.com", phone: "555-0100", queue: "q" });
    const [record] = await flushLogs();
    expect(record!.body).not.toMatch(/jane|555-0100/);
    expect(record!.body).toContain("queue: 'q'");
  });

  it("exports an Error under err, scrubbed", async () => {
    console.error(new Error("card 4111111111111111 declined"));
    const [record] = await flushLogs();
    expect(JSON.stringify(record)).not.toContain("4111111111111111");
    expect(record!.attributes.err).toMatchObject({ type: "Error" });
  });

  // WHY: arguments are sanitized one by one, so a value split across them only takes its shape
  // once they are joined; the joined message is scrubbed again.
  it("scrubs an SSN formed only once %s arguments are joined", async () => {
    console.error("ssn %s-%s", "123-45", "6789");
    const [record] = await flushLogs();
    expect(JSON.stringify(record)).not.toContain("123-45-6789");
    expect(record!.body).toBe("ssn [redacted]");
  });

  it("scrubs an account number formed only once arguments are joined", async () => {
    console.error("refund to %s%s", "4111111", "111111111");
    const [record] = await flushLogs();
    expect(JSON.stringify(record)).not.toContain("4111111111111111");
  });

  it("scrubs a second Error's message and stack", async () => {
    console.error(new Error("first"), new Error("applicant 123-45-6789 failed"));
    const [record] = await flushLogs();
    expect(JSON.stringify(record)).not.toContain("123-45-6789");
  });

  // WHY: the logger's JSON shows a Map as {}, but the console format shows its entries.
  it("redacts a PII key inside a Map, a Set and a class instance", async () => {
    class Lookup {
      readonly owner = new Map<string, unknown>([["password", "hunter2"]]);
    }
    console.error(
      "lookup failed",
      new Map([["phone", "555-0100"]]),
      new Set([{ ssn: "987654321" }]),
      new Lookup(),
      new Uint8Array([104, 117, 110]),
    );
    const [record] = await flushLogs();
    const text = JSON.stringify(record);
    expect(text).not.toMatch(/555-0100|987654321|hunter2/);
    expect(text).not.toContain("104, 117, 110");
  });

  // WHY: what is checked must be what is exported; a custom inspect, toString or toJSON renders
  // text the field sanitizer never walked.
  it("scrubs what custom inspect, toString and toJSON render", async () => {
    const custom = { [inspect.custom]: () => "ssn 123-45-6789" };
    const stringy = { toString: () => "account 4111111111111111" };
    const json = { toJSON: () => ({ email: "jane@example.com", note: "123-45-6789" }) };
    console.error("a %s b %O c %j d", stringy, custom, json);
    const [record] = await flushLogs();
    expect(JSON.stringify(record)).not.toMatch(/123-45-6789|4111111111111111|jane@example\.com/);
  });

  // WHY: console formatting prints a function's own properties and, under %s, its source; the
  // logger's JSON drops functions. Console capture must never export more than `log` would.
  it("exports no property of a function, top-level or nested", async () => {
    const handler = Object.assign(function handler() {
      return "source with hunter2";
    }, { owner: { firstName: "Zelda", password: "hunter2" } });
    console.error("b", handler, { cb: handler });
    console.error("c %s %o", handler, handler);
    const records = await flushLogs();
    expect(records).toHaveLength(2);
    expect(JSON.stringify(records)).not.toMatch(/Zelda|hunter2/);
  });

  // WHY: the logger's JSON shows a Map or Set as {}, wherever a toJSON put it.
  it("exports no Map, Set or byte view contents from inside a toJSON result", async () => {
    const value = {
      toJSON: () => ({
        nested: new Set([{ password: "hunter2" }]),
        map: new Map([["k", "Zelda"]]),
        bytes: new Uint8Array([104, 117, 110]),
      }),
    };
    console.error("d", value);
    const [record] = await flushLogs();
    expect(JSON.stringify(record)).not.toMatch(/hunter2|Zelda|104, 117, 110/);
  });

  // WHY: the capture runs on the caller's path; a huge array must cost bounded time.
  it("reads a bounded number of items from a huge array", async () => {
    let reads = 0;
    const huge = new Proxy(Array.from({ length: 200_000 }, (_, i) => i), {
      get(target, key, receiver) {
        if (typeof key === "string" && /^\d+$/.test(key)) reads++;
        return Reflect.get(target, key, receiver);
      },
    });
    written.error.mockImplementationOnce(() => undefined);
    console.error("big", huge);
    const [record] = await flushLogs();
    expect(reads).toBeLessThanOrEqual(2_000);
    expect(record!.body).toMatch(/^big \[/);
  });

  // WHY: with no logScope set, the scope filter must still keep the app's own lines.
  it("exports a console line and a log line under the default scope", async () => {
    console.error("from console");
    log.info("from the logger");
    const records = await flushLogs();
    expect(bodies()).toEqual(["from console", "from the logger"]);
    expect(records.map((r) => r.instrumentationScope.name)).toEqual(["acp-api", "acp-api"]);
  });

  it("exports no record from a scope other than the log scope", async () => {
    logs.getLogger("@opentelemetry/instrumentation-runtime-node").emit({ body: "raw jane@x.com" });
    log.info("kept");
    expect(bodies()).toEqual([]);
    await flushLogs();
    expect(bodies()).toEqual(["kept"]);
  });

  it("leaves console.log and console.info alone", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    console.info("not captured");
    await flushLogs();
    expect(bodies()).toEqual([]);
  });
});
