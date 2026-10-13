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
 * OpenTelemetry semantic-convention namespaces, and those of the instrumentations this package and
 * its apps load. Their attributes are matched by whole name only, so a generic app key (`name`,
 * `id`) never wipes `db.system.name` or `bullmq.job.id`.
 */
const OTEL_NAMESPACES = new Set([
  "bullmq",
  "client",
  "code",
  "db",
  "deployment",
  "enduser",
  "error",
  "exception",
  "host",
  "http",
  "messaging",
  "net",
  "network",
  "next",
  "nodejs",
  "otel",
  "peer",
  "pg",
  "prisma",
  "process",
  "rpc",
  "server",
  "service",
  "telemetry",
  "thread",
  "url",
  "user",
  "user_agent",
  "v8js",
]);

/**
 * A span attribute is an app key when its whole name is one, or, outside the OpenTelemetry
 * namespaces, when its last `.` segment is one (`acp.tenant.name`).
 */
export function isAppAttributeKey(key: string): boolean {
  if (appKeys.size === 0) return false;
  if (isAppKey(key)) return true;
  const dot = key.indexOf(".");
  if (dot === -1 || OTEL_NAMESPACES.has(key.slice(0, dot).toLowerCase())) return false;
  return isAppKey(key.slice(key.lastIndexOf(".") + 1));
}
