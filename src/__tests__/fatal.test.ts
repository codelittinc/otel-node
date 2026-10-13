import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installFatalHandlers } from "../fatal.js";
import { log } from "../shared-log.js";

function setup(
  flushTelemetry: (timeoutMs: number) => Promise<unknown>,
  report: (err: unknown) => void = () => undefined,
) {
  const target = new EventEmitter();
  const order: string[] = [];
  const exit = vi.fn((code: number) => void order.push(`exit ${code}`));
  installFatalHandlers({
    target: target as unknown as Pick<NodeJS.Process, "on">,
    stopIntake: () => void order.push("stop intake"),
    report: (err) => {
      order.push("report");
      report(err);
    },
    flushTelemetry: (timeoutMs) => {
      order.push(`flush telemetry ${timeoutMs}`);
      return flushTelemetry(timeoutMs);
    },
    exit,
  });
  return { target, order, exit };
}

// A crashed worker must not pick up new jobs while it flushes, and a dead collector must not keep
// a crashed process alive past the flush budget.
describe("installFatalHandlers", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it("logs, stops intake before any await, flushes, then exits 1", async () => {
    const fatal = vi.spyOn(log, "fatal").mockImplementation(() => undefined);
    const { target, order, exit } = setup(() => Promise.resolve());
    const err = new Error("boom");
    target.emit("uncaughtException", err);
    expect(order).toEqual(["stop intake", "report"]);
    expect(fatal).toHaveBeenCalledWith({ err }, "uncaught exception");
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    expect(order).toEqual(["stop intake", "report", "flush telemetry 2000", "exit 1"]);
    expect(process.exitCode).toBe(1);
  });

  it("exits after two seconds when the flush never finishes", async () => {
    vi.useFakeTimers();
    vi.spyOn(log, "fatal").mockImplementation(() => undefined);
    vi.spyOn(log, "flush").mockImplementation(() => undefined);
    const { target, exit } = setup(() => new Promise(() => undefined));
    target.emit("unhandledRejection", new Error("lost"));
    await vi.advanceTimersByTimeAsync(1_999);
    expect(exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("logs a second fatal but stops and exits only once", async () => {
    const fatal = vi.spyOn(log, "fatal").mockImplementation(() => undefined);
    const { target, order, exit } = setup(() => Promise.resolve());
    target.emit("uncaughtException", new Error("one"));
    target.emit("unhandledRejection", "two");
    await vi.waitFor(() => expect(exit).toHaveBeenCalled());
    expect(fatal).toHaveBeenCalledTimes(2);
    expect(order.filter((o) => o === "stop intake")).toHaveLength(1);
    expect(order.filter((o) => o === "report")).toHaveLength(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  // WHY: the error report goes to PostHog before the flush that sends it; a reporter that throws
  // must not keep a crashed process alive.
  it("reports the error once and still exits when the reporter throws", async () => {
    vi.spyOn(log, "fatal").mockImplementation(() => undefined);
    const reported: unknown[] = [];
    const err = new Error("boom");
    const { target, exit } = setup(
      () => Promise.resolve(),
      (e) => {
        reported.push(e);
        throw new Error("posthog down");
      },
    );
    target.emit("uncaughtException", err);
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    expect(reported).toEqual([err]);
  });
});
