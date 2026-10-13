/** Adds key names (matched whole, any letter case); throws on a key that is not a string. */
export declare function addAppKeys(keys: Iterable<string>): void;
/** Test seam: forgets the app-supplied keys. */
export declare function resetAppKeys(): void;
/** True when `key` is an app-supplied key name, in any letter case. */
export declare function isAppKey(key: string): boolean;
/**
 * Attributes the package's instrumentations, BullMQ and Prisma emit whose last segment is a
 * plausible generic app key (`name`, `id`, `method`). Only these exact names skip last-segment
 * matching, so `name` never wipes `db.system.name`, while an app's own `http.unitLabel` is still
 * redacted. Content-bearing attributes (`url.full`, `db.query.text`, job options and reasons) are
 * deliberately absent. Prisma's bare `name`, `method` and `model` are not exempt: a whole-name app
 * key matches them.
 */
export declare const EXEMPT_ATTRIBUTES: ReadonlySet<string>;
/**
 * A span attribute is an app key when its whole name is one, or its last `.` segment is one,
 * unless it is an exempt instrumentation attribute.
 */
export declare function isAppAttributeKey(key: string): boolean;
