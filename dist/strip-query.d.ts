export declare const URL_QUERY_START: RegExp;
/** `schemeless` reads a value with no scheme and no leading `/` as starting at its authority. */
export declare function stripQuery(url: string, schemeless?: boolean): string;
