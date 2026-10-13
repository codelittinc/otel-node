import type { Instrumentation } from "@opentelemetry/instrumentation";
import { addAppKeys } from "./app-keys.js";
import type { TelemetryEnv } from "./config.js";

/** An allowlist view: instruments named `<instrumentPrefix>*` export only these attributes. */
export interface MetricViewOptions {
  instrumentPrefix: string;
  allowedAttributes: readonly string[];
}

/** Context passed to `onError`: the service name, plus whatever the caller adds. */
export type ErrorHookContext = Record<string, string>;

export interface TelemetryOptions {
  serviceName: string;
  /** Only records from this logger scope are exported; defaults to `serviceName`. */
  logScope?: string;
  /** Without it, every metric attribute is kept. */
  metricViews?: MetricViewOptions;
  /** Appended to the package's own list, so Prisma and the like match the app's versions. */
  instrumentations?: Instrumentation[];
  /** Log field names redacted on top of the default PII key list; never removes a default. */
  redactKeys?: readonly string[];
  /** Receives every fatal error `installFatalHandlers` sees, when it is given no `report`. */
  onError?: (err: unknown, context: ErrorHookContext) => void;
  /** Read instead of `process.env`. */
  env?: TelemetryEnv;
  /** Incoming request paths that open no server span; each covers itself and everything below. */
  ignoredPaths?: readonly string[];
  /** False for a host that runs bundled CommonJS (Next.js): no ESM loader hook is registered. */
  esmLoaderHook?: boolean;
  /** False keeps log lines on stdout only; a host whose own code does not use the shared logger. */
  logs?: boolean;
}

let scope: string | undefined;
let service: string | undefined;
let errorHook: TelemetryOptions["onError"];

/** A checked copy of the caller's options, and the types of the redact keys it dropped. */
export interface CheckedOptions {
  options: TelemetryOptions;
  invalidKeyTypes: string[];
}

function check(ok: boolean, message: string): void {
  if (!ok) throw new TypeError(message);
}

/**
 * Validates and copies options without touching any state. Throws on options that cannot be read;
 * a redact key that is not a string is dropped and only its type is reported.
 */
export function checkOptions(input: TelemetryOptions): CheckedOptions {
  check(typeof input === "object" && input !== null, "options must be an object");
  const options = { ...input };
  check(typeof options.serviceName === "string", "serviceName must be a string");
  check(options.logScope === undefined || typeof options.logScope === "string", "bad logScope");
  check(options.onError === undefined || typeof options.onError === "function", "bad onError");
  check(options.env === undefined || typeof options.env === "object", "bad env");
  check(options.redactKeys === undefined || Array.isArray(options.redactKeys), "bad redactKeys");
  const keys: unknown[] = [...(options.redactKeys ?? [])];
  const invalidKeyTypes = keys
    .filter((key) => typeof key !== "string")
    .map((key) => (key === null ? "null" : typeof key));
  if (options.redactKeys) {
    options.redactKeys = keys.filter((key): key is string => typeof key === "string");
  }
  return { options, invalidKeyTypes };
}

/**
 * Applies checked options in one step: the log scope, the error hook and the redact keys. Nothing
 * here can throw, so a call never leaves its options half-applied.
 */
export function applyOptions(options: TelemetryOptions): void {
  scope = options.logScope?.trim() || options.serviceName;
  service = options.serviceName;
  errorHook = options.onError;
  if (options.redactKeys) addAppKeys(options.redactKeys);
}

/** The configured log scope; before `startTelemetry`, the service name from the environment. */
export function logScope(): string {
  return scope ?? (process.env.OTEL_SERVICE_NAME?.trim() || "unknown");
}

/** Calls the app's error hook, if any, with `service` set; never throws. */
export function reportError(err: unknown, context: ErrorHookContext = {}): void {
  try {
    errorHook?.(err, { service: service ?? "unknown", ...context });
  } catch {
    // reporting must never break the caller
  }
}

/** Equal arrays: the same items, by identity. */
function sameItems(a: unknown, b: unknown): boolean {
  if (!Array.isArray(a) || !Array.isArray(b)) return a === b;
  return a.length === b.length && a.every((item, i) => item === b[i]);
}

/** True when two calls pass the same options; `env` aside, since it only says whether to export. */
export function sameOptions(a: TelemetryOptions, b: TelemetryOptions): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  keys.delete("env");
  for (const key of keys) {
    const x = a[key as keyof TelemetryOptions];
    const y = b[key as keyof TelemetryOptions];
    if (key === "metricViews") {
      const [m, n] = [x as MetricViewOptions | undefined, y as MetricViewOptions | undefined];
      if (m?.instrumentPrefix !== n?.instrumentPrefix) return false;
      if (!sameItems(m?.allowedAttributes, n?.allowedAttributes)) return false;
    } else if (!sameItems(x, y)) return false;
  }
  return true;
}

/** Test seam: forgets the recorded options. */
export function resetOptions(): void {
  scope = undefined;
  service = undefined;
  errorHook = undefined;
}
