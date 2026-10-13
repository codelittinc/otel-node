import { createLogger } from "./logger.js";
import { currentService } from "./shared-log.js";
/** A logger that captures parsed records in memory, for tests. */
export function createTestLogger() {
    const records = [];
    const logger = createLogger(currentService, {
        write(line) {
            records.push(JSON.parse(line));
        },
    });
    return { logger, records };
}
