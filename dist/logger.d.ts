import { type DestinationStream, type Logger } from "pino";
/**
 * LOG_LEVEL (any case) when it names a level; anything else falls back to "info" rather than
 * throwing.
 */
export declare function resolveLogLevel(raw?: string | undefined): {
    level: string;
    invalid?: string;
};
export declare function announceLogLevel(logger: Logger): void;
/**
 * Builds a redacting pino logger that names its process in `app`. `app` is read on every line, so
 * a logger or child created before the process names itself still reports the configured name.
 */
export declare function createLogger(app: () => string, destination?: DestinationStream): Logger;
