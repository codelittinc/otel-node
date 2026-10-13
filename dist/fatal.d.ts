interface FatalOptions {
    /** Synchronous: stop taking new work (a BullMQ `worker.close()`, not awaited). */
    stopIntake?: () => void;
    /**
     * Reports the fatal error; called once, before the flush. Defaults to the `onError` hook given
     * to `startTelemetry`.
     */
    report?: (err: unknown) => void;
    /** Flushes telemetry; raced against the same budget as the log flush. */
    flushTelemetry?: (timeoutMs: number) => Promise<unknown>;
    exit?: (code: number) => void;
    target?: Pick<NodeJS.Process, "on">;
}
/**
 * Logs an uncaught exception or unhandled rejection as one JSON line under `err`, stops intake,
 * reports it, spends at most two seconds flushing, then exits 1. A second fatal while exiting is
 * logged only.
 */
export declare function installFatalHandlers(options?: FatalOptions): void;
export {};
