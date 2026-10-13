import { flushLog, log } from "./shared-log.js";
import { reportError } from "./options.js";
/** Total time a fatal exit may spend flushing logs and telemetry. */
const FATAL_FLUSH_MS = 2_000;
/**
 * Logs an uncaught exception or unhandled rejection as one JSON line under `err`, stops intake,
 * reports it, spends at most two seconds flushing, then exits 1. A second fatal while exiting is
 * logged only.
 */
export function installFatalHandlers(options = {}) {
    const { stopIntake, report = (err) => reportError(err), flushTelemetry, exit = (code) => process.exit(code), } = options;
    const target = options.target ?? process;
    let exiting = false;
    const fatal = (err, message) => {
        try {
            log.fatal({ err }, message);
        }
        catch {
            // the exit still has to happen
        }
        if (exiting)
            return;
        exiting = true;
        process.exitCode = 1;
        try {
            stopIntake?.();
        }
        catch {
            // a failing close must not keep a crashed process alive
        }
        try {
            report(err);
        }
        catch {
            // reporting must not keep a crashed process alive
        }
        const budget = new Promise((resolve) => setTimeout(resolve, FATAL_FLUSH_MS).unref());
        const flushes = Promise.allSettled([
            flushLog(FATAL_FLUSH_MS),
            Promise.resolve().then(() => flushTelemetry?.(FATAL_FLUSH_MS)),
        ]);
        void Promise.race([flushes, budget]).then(() => exit(1));
    };
    target.on("unhandledRejection", (reason) => fatal(reason, "unhandled rejection"));
    target.on("uncaughtException", (err) => fatal(err, "uncaught exception"));
}
