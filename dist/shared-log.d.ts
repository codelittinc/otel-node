import type { Logger } from "pino";
/** The configured service name, else `OTEL_SERVICE_NAME`, else "unknown". */
export declare function currentService(): string;
/**
 * The one logger every process shares. Apps import it directly; modules and packages log through a
 * child that binds `component` (`log.child({ component: "db" })`), so their lines carry the
 * process's name in `app`.
 */
export declare const log: Logger;
/**
 * Names the process on every log line (the `app` field), including lines from loggers created
 * before this call. Each entry point calls it once. The first name wins: a later call with a
 * different name is ignored and warns, so no imported module can rename the process.
 */
export declare function configureLogger({ service }: {
    service: string;
}): void;
/** Resolves once buffered log lines are written, or after `timeoutMs`; never rejects. */
export declare function flushLog(timeoutMs?: number): Promise<void>;
