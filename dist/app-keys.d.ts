/** Adds key names (matched whole, any letter case); throws on a key that is not a string. */
export declare function addAppKeys(keys: Iterable<string>): void;
/** Test seam: forgets the app-supplied keys. */
export declare function resetAppKeys(): void;
/** True when `key` is an app-supplied key name, in any letter case. */
export declare function isAppKey(key: string): boolean;
/**
 * A span attribute is an app key when its whole name is one, or, outside the OpenTelemetry
 * namespaces, when its last `.` segment is one (`acp.tenant.name`).
 */
export declare function isAppAttributeKey(key: string): boolean;
