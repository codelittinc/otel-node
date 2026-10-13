import type { Logger } from "pino";
/** A logger that captures parsed records in memory, for tests. */
export declare function createTestLogger(): {
    logger: Logger;
    records: Record<string, unknown>[];
};
