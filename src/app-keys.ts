/** App-supplied key names, lower-cased; redacted in log fields and span attributes. */
const appKeys = new Set<string>();

/** Adds key names (matched whole, any letter case); throws on a key that is not a string. */
export function addAppKeys(keys: Iterable<string>): void {
  const names = [...keys].map((key) => {
    if (typeof key !== "string") throw new TypeError("redactKeys must hold strings");
    return key.trim().toLowerCase();
  });
  for (const name of names) if (name) appKeys.add(name);
}

/** Test seam: forgets the app-supplied keys. */
export function resetAppKeys(): void {
  appKeys.clear();
}

/** True when `key` is an app-supplied key name, in any letter case. */
export function isAppKey(key: string): boolean {
  return appKeys.size > 0 && appKeys.has(key.toLowerCase());
}

/**
 * Attributes the package's instrumentations, BullMQ and Prisma emit whose last segment is a
 * plausible generic app key (`name`, `id`, `method`). Only these exact names skip last-segment
 * matching, so `name` never wipes `db.system.name`, while an app's own `http.unitLabel` is still
 * redacted. Content-bearing attributes (`url.full`, `db.query.text`, job options and reasons) are
 * deliberately absent. Prisma's bare `name`, `method` and `model` are not exempt: a whole-name app
 * key matches them.
 */
export const EXEMPT_ATTRIBUTES: ReadonlySet<string> = new Set([
  // http and undici
  "http.request.method",
  "http.request.method_original",
  "http.response.status_code",
  "http.route",
  "server.address",
  "server.port",
  "network.peer.port",
  "network.protocol.version",
  "url.scheme",
  "error.type",
  "user_agent.synthetic.type",
  // ioredis, pg and Prisma
  "db.system.name",
  "db.operation.name",
  "db.namespace",
  "db.client.connection.pool.name",
  "db.client.connection.state",
  // messaging semantic conventions
  "messaging.destination.name",
  // bullmq: names and identifiers
  "bullmq.queue.name",
  "bullmq.queue.operation",
  "bullmq.job.name",
  "bullmq.job.id",
  "bullmq.job.ids",
  "bullmq.job.key",
  "bullmq.job.type",
  "bullmq.job.state",
  "bullmq.job.scheduler.id",
  "bullmq.worker.name",
  "bullmq.worker.id",
  "bullmq.flow.name",
  "bullmq.queue.jobs.state",
  // bullmq: counts and timings
  "bullmq.job.attempts.made",
  "bullmq.job.bulk.count",
  "bullmq.job.processed.timestamp",
  "bullmq.job.attempt_finished_timestamp",
  "bullmq.job.duration",
  "bullmq.queue.drain.delay",
  "bullmq.queue.grace",
  "bullmq.queue.clean.limit",
  "bullmq.queue.clean.count",
  "bullmq.queue.rate.limit",
  "bullmq.queue.event.max.length",
  "bullmq.worker.rate.limit",
  "bullmq.worker.do.not.wait.active",
  "bullmq.worker.force.close",
  "bullmq.worker.stalled.jobs",
  "bullmq.worker.failed.jobs",
  "bullmq.worker.jobs.to.extend.locks",
  "bullmq.jobs.completed",
  "bullmq.jobs.failed",
  "bullmq.jobs.delayed",
  "bullmq.jobs.retried",
  "bullmq.jobs.waiting",
  "bullmq.jobs.waiting_children",
  // exception events
  "exception.type",
]);

/**
 * A span attribute is an app key when its whole name is one, or its last `.` segment is one,
 * unless it is an exempt instrumentation attribute.
 */
export function isAppAttributeKey(key: string): boolean {
  if (appKeys.size === 0) return false;
  if (isAppKey(key)) return true;
  if (EXEMPT_ATTRIBUTES.has(key)) return false;
  return isAppKey(key.slice(key.lastIndexOf(".") + 1));
}
