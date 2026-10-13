/** The label every value outside an allowlist collapses into. */
export declare const OTHER_LABEL = "other";
/**
 * A metric label from a closed set: the value itself when the allowlist holds it, otherwise
 * `"other"`. Keeps raw paths, ids and error text from ever becoming a label value.
 */
export declare function boundedLabel<T extends string>(value: unknown, allowlist: ReadonlySet<T> | readonly T[]): T | typeof OTHER_LABEL;
