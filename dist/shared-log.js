import { announceLogLevel, createLogger } from "./logger.js";
let configuredService;
/** The configured service name, else `OTEL_SERVICE_NAME`, else "unknown". */
export function currentService() {
    return configuredService ?? (process.env.OTEL_SERVICE_NAME?.trim() || "unknown");
}
/**
 * The one logger every process shares. Apps import it directly; modules and packages log through a
 * child that binds `component` (`log.child({ component: "db" })`), so their lines carry the
 * process's name in `app`.
 */
export const log = createLogger(currentService);
/**
 * Names the process on every log line (the `app` field), including lines from loggers created
 * before this call. Each entry point calls it once. The first name wins: a later call with a
 * different name is ignored and warns, so no imported module can rename the process.
 */
export function configureLogger({ service }) {
    if (configuredService === undefined) {
        configuredService = service;
        announceLogLevel(log);
        return;
    }
    if (service !== configuredService) {
        log.warn({ event: "logger_reconfigure_ignored", requested: service }, "logger already configured, keeping the first service name");
    }
}
/** Resolves once buffered log lines are written, or after `timeoutMs`; never rejects. */
export function flushLog(timeoutMs = 1_000) {
    return new Promise((resolve) => {
        const timer = setTimeout(resolve, timeoutMs);
        try {
            log.flush(() => {
                clearTimeout(timer);
                resolve();
            });
        }
        catch {
            clearTimeout(timer);
            resolve();
        }
    });
}
