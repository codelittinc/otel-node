import { describe, expect, it } from "vitest";
import { createTestLogger } from "../testing.js";

const named = (name: string, message: string, extra: object = {}) =>
  Object.assign(new Error(message), { name }, extra);

function logged(fields: Record<string, unknown>): { line: string; err: Record<string, unknown> } {
  const { logger, records } = createTestLogger();
  logger.error(fields, "failed");
  return { line: JSON.stringify(records[0]), err: records[0]!.err as Record<string, unknown> };
}

// An error's own properties are whatever a library attached: request bodies, commands, row values.
// Only the listed fields may leave, so a new library cannot leak by adding a property.
describe("deny-by-default error serialization", () => {
  it("drops an ioredis ReplyError's command args", () => {
    const err = named("ReplyError", "WRONGTYPE Operation against a key", {
      command: { name: "set", args: ["bull:email:1", '{"to":"jane@example.com","jobId":"j-1"}'] },
    });
    const { line, err: out } = logged({ err });
    expect(line).not.toMatch(/jane@example\.com|bull:email:1/);
    expect(out).toMatchObject({ type: "Error", name: "ReplyError", message: err.message });
  });

  it("drops the input of a Node ERR_INVALID_URL", () => {
    let err: unknown;
    try {
      new URL("https://jane:hunter2@exa mple.com/x");
    } catch (caught) {
      err = caught;
    }
    const { line, err: out } = logged({ err });
    expect(line).not.toMatch(/hunter2|jane/);
    expect(out).toMatchObject({
      type: "TypeError",
      code: "ERR_INVALID_URL",
      message: "Invalid URL",
    });
  });

  it("drops a pg DatabaseError's detail", () => {
    const err = named("error", 'new row violates check constraint "chk_token"', {
      code: "23514",
      detail: "Failing row contains (t-1, Bearer SENTINEL-TOKEN-9, 2026-01-01).",
      table: "api_tokens",
    });
    const { line, err: out } = logged({ err });
    expect(line).not.toContain("SENTINEL-TOKEN-9");
    expect(out).toMatchObject({ code: "23514", message: err.message });
    expect(out).not.toHaveProperty("detail");
  });

  it("keeps only type, name, message, stack and codes on an unknown error", () => {
    const err = named("CustomError", "bad", {
      code: "E1",
      errorCode: "X",
      status: 500,
      statusCode: 502,
      body: { first_name: "Jane" },
      response: { data: "r" },
      config: { headers: { Authorization: "Bearer SENTINEL-3" } },
      raw: "raw",
      headers: { a: "b" },
      input: "i",
    });
    const { err: out } = logged({ err });
    expect(Object.keys(out).sort()).toEqual(
      ["code", "errorCode", "message", "name", "stack", "status", "statusCode", "type"].sort(),
    );
  });

  it("sanitizes every link of the cause chain the same way", () => {
    const inner = named("ReplyError", "inner", { command: { args: ["SENTINEL-C"] }, code: "E2" });
    const err = new Error("outer", { cause: inner });
    const { line, err: out } = logged({ err });
    expect(line).not.toContain("SENTINEL-C");
    expect(out.cause).toMatchObject({ name: "ReplyError", message: "inner", code: "E2" });
  });

  it("serializes AggregateError members", () => {
    const err = new AggregateError(
      [named("PrismaClientKnownRequestError", "x=jane@example.com", { code: "P2002" })],
      "all failed",
    );
    const { line, err: out } = logged({ err });
    expect(line).not.toContain("jane@example.com");
    expect(out.errors).toEqual([
      expect.objectContaining({ message: "PrismaClientKnownRequestError P2002" }),
    ]);
  });
});

describe("error families", () => {
  it("keeps value-free code for Prisma errors, including init errors' errorCode", () => {
    const known = named("PrismaClientKnownRequestError", "Unique failed on jane@example.com", {
      code: "P2002",
      meta: { target: ["email"], cause: "jane@example.com" },
    });
    const init = named("PrismaClientInitializationError", "Can't reach jane@db.example.com", {
      errorCode: "P1001",
    });
    const a = logged({ err: known });
    const b = logged({ err: init });
    expect(a.line + b.line).not.toContain("jane@");
    expect(a.err).toMatchObject({
      message: "PrismaClientKnownRequestError P2002",
      meta: { target: ["email"] },
    });
    expect(b.err).toMatchObject({ message: "PrismaClientInitializationError P1001" });
  });

  it("keeps value-free code for DriverAdapterError and drops its cause", () => {
    const err = named("DriverAdapterError", "dup key (ssn)=(123-45-6789)", {
      cause: named("Error", "value 123-45-6789", { originalCode: "23505" }),
    });
    const { line, err: out } = logged({ err });
    expect(line).not.toContain("123-45-6789");
    expect(out).toMatchObject({ message: "DriverAdapterError 23505" });
    expect(out).not.toHaveProperty("cause");
  });

  it("drops ZodError issues and values", () => {
    const err = named("ZodError", "received bob@secret.test", {
      issues: [{ code: "invalid_string", received: "bob@secret.test" }],
    });
    const { line, err: out } = logged({ err });
    expect(line).not.toContain("bob@secret.test");
    expect(out).toMatchObject({ message: "ZodError 1 issue(s)" });
    expect(out).not.toHaveProperty("issues");
  });

  it("keeps only allowlisted fields of a Stripe error", () => {
    class StripeCardError extends Error {}
    const err = Object.assign(new StripeCardError("Your card was declined."), {
      name: "StripeCardError",
      type: "StripeCardError",
      code: "card_declined",
      decline_code: "insufficient_funds",
      statusCode: 402,
      requestId: "req_1",
      raw: { payment_method: { billing_details: { name: "Jane Q. Resident" } } },
      headers: { "idempotency-key": "k" },
    });
    const { line, err: out } = logged({ err });
    expect(line).not.toMatch(/Jane Q\. Resident|idempotency-key/);
    expect(out).toMatchObject({
      type: "StripeCardError",
      code: "card_declined",
      decline_code: "insufficient_funds",
      statusCode: 402,
      requestId: "req_1",
      message: "Your card was declined.",
    });
  });

  it("drops the response body of a HappyCo error but keeps status and outcome", () => {
    const err = named("HappyCoError", "HappyCo answered 500", {
      status: 500,
      outcome: "UNKNOWN",
      body: { errors: [{ message: "tenant Jane at 42 Privet Drive" }] },
    });
    const { line, err: out } = logged({ err });
    expect(line).not.toMatch(/Jane|Privet/);
    expect(out).toMatchObject({ status: 500, outcome: "UNKNOWN", message: "HappyCo answered 500" });
  });
});

describe("error text scrubbing", () => {
  it("scrubs SSN, email and long digit runs from a message and its stack header", () => {
    const err = new Error("lookup failed for alice@example.com 123-45-6789 acct 000123456789");
    const { err: out } = logged({ err });
    expect(out.message).toBe("lookup failed for [redacted] [redacted] acct [redacted]");
    expect(out.stack).not.toMatch(/alice@example\.com|123-45-6789|000123456789/);
  });

  // Provider ids are prefixed or UUIDs, so the digit scrub must leave them readable.
  it("leaves UUIDs and prefixed provider ids alone", () => {
    const text = "pi_12345678901 for 123e4567-e89b-12d3-a456-426614174000 req_00000000";
    const { err: out } = logged({ err: new Error(text) });
    expect(out.message).toBe(text);
  });

  it("keeps stack frames intact, including a pnpm store path", () => {
    const err = new Error("boom for jane@example.com");
    const frame =
      "    at run (/app/node_modules/.pnpm/@hono+node-server@1.19.5_hono@4.9.0/node_modules/x.js:1:2)";
    err.stack = `Error: boom for jane@example.com\n${frame}`;
    const { err: out } = logged({ err });
    expect(out.stack).toBe(`Error: boom for [redacted]\n${frame}`);
  });

  it("keeps the original stack frames when a chain is copied", () => {
    function thrownHere() {
      return new Error("outer", { cause: new Error("inner") });
    }
    const { err: out } = logged({ err: thrownHere() });
    expect(String(out.stack)).toContain("thrownHere");
  });

  it("keeps the message of a plain Error", () => {
    expect(logged({ err: new Error("queue is down") }).err).toMatchObject({
      message: "queue is down",
    });
  });
});

describe("error serializer robustness", () => {
  it("does not throw on a frozen Prisma error", () => {
    const err = Object.freeze(
      named("PrismaClientKnownRequestError", "x=jane@example.com", { code: "P2002" }),
    );
    expect(logged({ err }).line).not.toContain("jane@example.com");
  });

  it("does not throw on a throwing cause getter", () => {
    const err = new Error("boom");
    Object.defineProperty(err, "cause", {
      get() {
        throw new Error("nope");
      },
    });
    expect(logged({ err }).err).toMatchObject({ message: "boom" });
  });

  it("serializes errors under `error` and `e` keys", () => {
    const mk = () =>
      named("PrismaClientKnownRequestError", "x=jane@example.com", { code: "P2002" });
    const { logger, records } = createTestLogger();
    logger.error({ error: mk(), e: mk() }, "f");
    expect(JSON.stringify(records[0])).not.toContain("jane@example.com");
    expect(records[0]).toMatchObject({ error: { message: "PrismaClientKnownRequestError P2002" } });
  });

  it("drops causes beyond the depth cap", () => {
    let err: Error = named("PrismaClientKnownRequestError", "x=jane@example.com", {
      code: "P2002",
    });
    for (let i = 0; i < 15; i++) err = new Error(`level ${i}`, { cause: err });
    expect(logged({ err }).line).not.toContain("jane@example.com");
  });

  it("scrubs the name and type of a non-Error err object", () => {
    const { err, line } = logged({ err: { name: "jane@example.com", message: "m" } });
    expect(line).not.toContain("jane@example.com");
    expect(err).toMatchObject({ type: "[redacted]", name: "[redacted]" });
  });

  it("marks a cause cycle and a self-referencing errors array as circular", () => {
    const cyclic = new Error("loop");
    cyclic.cause = cyclic;
    expect(logged({ err: cyclic }).err).toMatchObject({ message: "loop", cause: "[circular]" });

    const aggregate = new AggregateError([], "many");
    (aggregate as { errors: unknown[] }).errors = [aggregate];
    expect(logged({ err: aggregate }).err).toMatchObject({ errors: ["[circular]"] });
  });

  it("serializes a shared, non-cyclic error everywhere it appears", () => {
    const shared = new Error("shared");
    const { err } = logged({ err: new AggregateError([shared, shared], "two") });
    expect(err.errors).toEqual([
      expect.objectContaining({ message: "shared" }),
      expect.objectContaining({ message: "shared" }),
    ]);
  });
});
