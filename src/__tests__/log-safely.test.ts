import { describe, expect, it, vi } from "vitest";
import { diagLogger, log } from "../log-safely.js";

// OTel's diagnostics carry exporter errors and URLs; they must go through the redacting logger
// rather than straight to the console.
describe("diagLogger", () => {
  it("routes each diag level to the telemetry logger, keeping only an Error argument", () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
    const trace = vi.spyOn(log, "trace").mockImplementation(() => undefined);
    try {
      const err = new Error("export failed");
      diagLogger.warn("exporter failed", { url: "https://x?key=k" }, err);
      diagLogger.verbose("detail", "extra");
      expect(warn).toHaveBeenCalledWith({ event: "otel_diag", err }, "exporter failed");
      expect(trace).toHaveBeenCalledWith({ event: "otel_diag" }, "detail");
    } finally {
      warn.mockRestore();
      trace.mockRestore();
    }
  });

  it("never throws when the logger does", () => {
    const error = vi.spyOn(log, "error").mockImplementation(() => {
      throw new Error("stream gone");
    });
    try {
      expect(() => diagLogger.error("boom")).not.toThrow();
    } finally {
      error.mockRestore();
    }
  });
});
