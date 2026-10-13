import { formatWithOptions } from "node:util";
import type { Logger } from "pino";
import { createLogger } from "./logger.js";
import { sanitizeLogValue } from "./log-redact.js";
import { hasLogLineSink } from "./log-sink.js";
import { currentService } from "./shared-log.js";

const LEVELS = ["warn", "error"] as const;
type Level = (typeof LEVELS)[number];
type ConsoleMethod = (...args: unknown[]) => void;

let originals: Partial<Record<Level, ConsoleMethod>> | undefined;

/**
 * Sends every `console.warn` and `console.error` line to OTLP logs, through the logger's scrub and
 * under the configured log scope, and still writes it to the console unchanged. Only the scrubbed
 * copy is exported; stdout keeps the app's own line. Calling it again changes nothing.
 */
export function captureConsole(): void {
  if (originals) return;
  originals = {};
  // Writes nothing itself: the line reaches only the OTLP sink.
  const logger = createLogger(currentService, { write: () => undefined }).child({
    component: "console",
  });
  for (const level of LEVELS) {
    const original = console[level] as ConsoleMethod;
    originals[level] = original;
    console[level] = (...args: unknown[]): void => {
      original.apply(console, args);
      exportLine(logger, level, args);
    };
  }
}

/** Puts back the console methods `captureConsole` replaced. */
export function releaseConsole(): void {
  if (!originals) return;
  for (const level of LEVELS) {
    const original = originals[level];
    if (original) console[level] = original;
  }
  originals = undefined;
}

/**
 * The first Error goes under `err`; every other argument is sanitized like a log field (PII keys
 * redacted, strings scrubbed) before it is formatted into the message.
 */
function exportLine(logger: Logger, level: Level, args: unknown[]): void {
  if (!hasLogLineSink()) return;
  try {
    const err = args.find((arg) => arg instanceof Error);
    const rest = args.filter((arg) => arg !== err).map(sanitizeLogValue);
    const message = rest.length > 0 ? formatWithOptions({ colors: false }, ...rest) : undefined;
    if (err === undefined) logger[level](message ?? "");
    else if (message === undefined) logger[level]({ err });
    else logger[level]({ err }, message);
  } catch {
    // the console line is already written
  }
}
