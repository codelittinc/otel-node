import type { DiagLogger } from "@opentelemetry/api";
export declare const log: import("pino").Logger<never, boolean>;
type Level = "trace" | "debug" | "info" | "warn" | "error";
/** Telemetry never breaks the app, so not even a failing logger may throw out of it. */
export declare function logSafely(level: Level, fields: Record<string, unknown>, message: string): void;
export declare const diagLogger: DiagLogger;
export {};
