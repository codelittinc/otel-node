/** Receives each serialized line the logger writes; installed only once the SDK has booted. */
export type LogLineSink = (line: string) => void;
/** Installs (or, with undefined, removes) the sink every logger line is copied to. */
export declare function setLogLineSink(next: LogLineSink | undefined): void;
export declare function hasLogLineSink(): boolean;
/**
 * Copies a written line to the sink and returns it unchanged. A sink that throws, or a line logged
 * while the sink is running, is dropped: exporting must never break or recurse into a log call.
 */
export declare function forwardLogLine(line: string): string;
