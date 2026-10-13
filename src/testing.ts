import type { Logger } from "pino";
import { createLogger } from "./logger.js";
import { currentService } from "./shared-log.js";

/** A logger that captures parsed records in memory, for tests. */
export function createTestLogger(): { logger: Logger; records: Record<string, unknown>[] } {
  const records: Record<string, unknown>[] = [];
  const logger = createLogger(currentService, {
    write(line: string) {
      records.push(JSON.parse(line) as Record<string, unknown>);
    },
  });
  return { logger, records };
}
