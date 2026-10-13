/** Receives each serialized line the logger writes; installed only once the SDK has booted. */
export type LogLineSink = (line: string) => void;

let sink: LogLineSink | undefined;
let forwarding = false;

/** Installs (or, with undefined, removes) the sink every logger line is copied to. */
export function setLogLineSink(next: LogLineSink | undefined): void {
  sink = next;
}

export function hasLogLineSink(): boolean {
  return sink !== undefined;
}

/**
 * Copies a written line to the sink and returns it unchanged. A sink that throws, or a line logged
 * while the sink is running, is dropped: exporting must never break or recurse into a log call.
 */
export function forwardLogLine(line: string): string {
  const current = sink;
  if (current === undefined || forwarding) return line;
  forwarding = true;
  try {
    current(line);
  } catch {
    // the line still reaches stdout
  } finally {
    forwarding = false;
  }
  return line;
}
