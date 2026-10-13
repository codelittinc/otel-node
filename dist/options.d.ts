import type { Instrumentation } from "@opentelemetry/instrumentation";
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
/** Records the options that outlive `startTelemetry`: the log scope and the error hook. */
export declare function applyOptions(options: TelemetryOptions): void;
/** The configured log scope; before `startTelemetry`, the service name from the environment. */
export declare function logScope(): string;
/** Calls the app's error hook, if any, with `service` set; never throws. */
export declare function reportError(err: unknown, context?: ErrorHookContext): void;
/** True when two calls pass the same options; `env` aside, since it only says whether to export. */
export declare function sameOptions(a: TelemetryOptions, b: TelemetryOptions): boolean;
/** Test seam: forgets the recorded options. */
export declare function resetOptions(): void;
