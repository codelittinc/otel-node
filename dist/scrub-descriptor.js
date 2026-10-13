export function describePatterns(patterns) {
    const out = {};
    for (const name of Object.keys(patterns)) {
        const { source, flags } = patterns[name];
        out[name] = Object.freeze({ source, flags });
    }
    return Object.freeze(out);
}
export function describeKeySets(sets) {
    const out = {};
    for (const name of Object.keys(sets))
        out[name] = Object.freeze([...sets[name]].sort());
    return Object.freeze(out);
}
