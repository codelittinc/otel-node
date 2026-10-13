/** App-supplied key names, lower-cased; redacted in log fields and span attributes. */
const appKeys = new Set();
/** Adds key names (matched whole, any letter case); throws on a key that is not a string. */
export function addAppKeys(keys) {
    const names = [...keys].map((key) => {
        if (typeof key !== "string")
            throw new TypeError("redactKeys must hold strings");
        return key.trim().toLowerCase();
    });
    for (const name of names)
        if (name)
            appKeys.add(name);
}
/** Test seam: forgets the app-supplied keys. */
export function resetAppKeys() {
    appKeys.clear();
}
/** True when `key` is an app-supplied key name, in any letter case. */
export function isAppKey(key) {
    return appKeys.size > 0 && appKeys.has(key.toLowerCase());
}
/** A span attribute is an app key when its whole name or its last `.` segment is one. */
export function isAppAttributeKey(key) {
    if (appKeys.size === 0)
        return false;
    return isAppKey(key) || isAppKey(key.slice(key.lastIndexOf(".") + 1));
}
