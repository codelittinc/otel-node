import { inspect } from "node:util";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { captureConsole, releaseConsole } from "../console-capture.js";
import { createTestLogger } from "../testing.js";
import { bootWithMemoryLogs, exported, flushLogs, stopTelemetry } from "./otlp-export-helpers.js";

vi.mock("@opentelemetry/exporter-logs-otlp-proto", async () =>
  (await import("./otlp-export-helpers.js")).memoryLogExporterModule(),
);

const LEAK = /hunter2|4111111111111111|123-45-6789/;
const TEXT = "hunter2 4111111111111111 123-45-6789";
const payload = () => ({
  password: "hunter2",
  accountNumber: "4111111111111111",
  note: "ssn 123-45-6789",
});

class LeakyDate extends Date {
  override toJSON(): string {
    return payload() as unknown as string;
  }
  override toISOString(): string {
    return TEXT;
  }
}

/** Values whose own serialization hook emits PII the sanitizer never walked. */
const HOOKS: [string, () => unknown][] = [
  ["toJSON on an object", () => ({ toJSON: payload })],
  ["toJSON on a function", () => Object.assign(() => undefined, { toJSON: payload })],
  ["toJSON on a Map", () => Object.assign(new Map(), { toJSON: payload })],
  ["toJSON on a Set", () => Object.assign(new Set(), { toJSON: payload })],
  ["toJSON and toISOString on a Date subclass", () => new LeakyDate(0)],
  ["toJSON on a RegExp", () => Object.assign(/x/, { toJSON: payload })],
  ["toJSON on a byte view", () => Object.assign(new Uint8Array(2), { toJSON: payload })],
  ["toJSON returning a value with its own toJSON", () => ({ toJSON: () => ({ toJSON: payload }) })],
  ["own properties on a Map", () => Object.assign(new Map(), payload())],
  ["own properties on a function", () => Object.assign(() => undefined, payload())],
  ["inspect.custom", () => ({ [inspect.custom]: () => TEXT })],
  ["toString", () => ({ toString: () => TEXT })],
  ["Symbol.toPrimitive", () => ({ [Symbol.toPrimitive]: () => TEXT })],
  [
    "getters",
    () => ({
      get password() {
        return "hunter2";
      },
      get accountNumber() {
        return "4111111111111111";
      },
      get note() {
        return "ssn 123-45-6789";
      },
    }),
  ],
];

const POSITIONS: [string, (value: unknown) => unknown][] = [
  ["top level", (value) => value],
  ["nested", (value) => ({ outer: { value } })],
  ["inside an array", (value) => [1, value]],
  ["inside a Map", (value) => new Map([["k", value]])],
  ["inside a Set", (value) => new Set([value])],
  ["inside a toJSON result", (value) => ({ toJSON: () => ({ value }) })],
];

const CASES = HOOKS.flatMap(([hook, make]) =>
  POSITIONS.map(([position, place]) => [hook, position, () => place(make())] as const),
);

const original = { warn: console.warn, error: console.error };

beforeAll(async () => {
  console.warn = () => undefined;
  console.error = () => undefined;
  await bootWithMemoryLogs({ serviceName: "acp-api" });
  captureConsole();
  await flushLogs();
});

afterAll(async () => {
  releaseConsole();
  console.warn = original.warn;
  console.error = original.error;
  await stopTelemetry();
});

beforeEach(async () => {
  await flushLogs();
  exported.length = 0;
});

// WHY: a value's own serialization hook runs after the sanitizer unless the sanitizer's output is
// inert; whatever the hook emits would be exported unredacted.
describe("serialization hooks", () => {
  it.each(CASES)("log: %s, %s", (_hook, _position, value) => {
    const { logger, records } = createTestLogger();
    logger.error({ field: value() }, "as a field");
    logger.error("as format args %s %o %j", value(), value() as object, value() as object);
    const placed = value();
    if (typeof placed === "object" && placed !== null) logger.error(placed, "as the object");
    expect(records.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(records)).not.toMatch(LEAK);
  });

  it.each(CASES)("console capture: %s, %s", async (_hook, _position, value) => {
    console.error("as an argument", value());
    console.error("as format args %s %o %O %j", value(), value(), value(), value());
    const records = await flushLogs();
    expect(records).toHaveLength(2);
    expect(JSON.stringify(records.map((r) => [r.body, r.attributes]))).not.toMatch(LEAK);
  });

  // An error is serialized deny-by-default; its message and Prisma's meta target are the fields
  // that are copied from the caller's value.
  it.each(HOOKS)("log: %s as an error's message or Prisma meta target", (_hook, make) => {
    const { logger, records } = createTestLogger();
    const withMessage = Object.assign(new Error("x"), { message: make() });
    const prisma = Object.assign(new Error("unique"), {
      name: "PrismaClientKnownRequestError",
      code: "P2002",
      meta: { target: ["email", make()] },
    });
    logger.error({ err: withMessage });
    logger.error(withMessage);
    logger.error({ err: prisma }, "prisma");
    expect(JSON.stringify(records)).not.toMatch(LEAK);
  });

  it.each(HOOKS)("console capture: %s as an error's message", async (_hook, make) => {
    console.error(Object.assign(new Error("x"), { message: make() }));
    console.error("second", Object.assign(new Error("y"), { message: make() }));
    const records = await flushLogs();
    expect(records).toHaveLength(2);
    expect(JSON.stringify(records.map((r) => [r.body, r.attributes]))).not.toMatch(LEAK);
  });
});
