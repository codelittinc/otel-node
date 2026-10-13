/** A regex's source and flags, for the scrub contract test; never the stateful RegExp itself. */
export interface PatternDescriptor {
  readonly source: string;
  readonly flags: string;
}

export function describePatterns<K extends string>(
  patterns: Record<K, RegExp>,
): Readonly<Record<K, PatternDescriptor>> {
  const out = {} as Record<K, PatternDescriptor>;
  for (const name of Object.keys(patterns) as K[]) {
    const { source, flags } = patterns[name];
    out[name] = Object.freeze({ source, flags });
  }
  return Object.freeze(out);
}

export function describeKeySets<K extends string>(
  sets: Record<K, Iterable<string>>,
): Readonly<Record<K, readonly string[]>> {
  const out = {} as Record<K, readonly string[]>;
  for (const name of Object.keys(sets) as K[]) out[name] = Object.freeze([...sets[name]].sort());
  return Object.freeze(out);
}
