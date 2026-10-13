/** The label every value outside an allowlist collapses into. */
export const OTHER_LABEL = "other";
/**
 * A metric label from a closed set: the value itself when the allowlist holds it, otherwise
 * `"other"`. Keeps raw paths, ids and error text from ever becoming a label value.
 */
export function boundedLabel(value, allowlist) {
    if (typeof value !== "string")
        return OTHER_LABEL;
    const allowed = allowlist instanceof Set
        ? allowlist.has(value)
        : allowlist.includes(value);
    return allowed ? value : OTHER_LABEL;
}
