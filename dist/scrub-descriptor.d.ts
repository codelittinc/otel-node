/** A regex's source and flags, for the scrub contract test; never the stateful RegExp itself. */
export interface PatternDescriptor {
    readonly source: string;
    readonly flags: string;
}
export declare function describePatterns<K extends string>(patterns: Record<K, RegExp>): Readonly<Record<K, PatternDescriptor>>;
export declare function describeKeySets<K extends string>(sets: Record<K, Iterable<string>>): Readonly<Record<K, readonly string[]>>;
