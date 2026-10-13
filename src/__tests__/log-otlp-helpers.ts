import { Writable } from "node:stream";
import {
  InMemoryLogRecordExporter,
  LoggerProvider,
  SimpleLogRecordProcessor,
  type ReadableLogRecord,
} from "@opentelemetry/sdk-logs";
import { setLogLineSink } from "../log-sink.js";
import { logLineSink, ScopedLogRecordProcessor } from "../log-otlp.js";

/** Backbone's log scope, passed where the app supplies one. */
export const LOG_SCOPE = "backbone";

export function capture(): { lines: string[]; stream: Writable } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  return { lines, stream };
}

/** Installs the real sink over an in-memory exporter behind the production scope filter. */
export function exporting() {
  const exporter = new InMemoryLogRecordExporter();
  const provider = new LoggerProvider({
    processors: [
      new ScopedLogRecordProcessor(new SimpleLogRecordProcessor({ exporter }), LOG_SCOPE),
    ],
  });
  setLogLineSink(logLineSink(provider.getLogger(LOG_SCOPE)));
  return {
    provider,
    /** Records exported so far, once the sink's queued emissions have run. */
    records: async (): Promise<ReadableLogRecord[]> => {
      await Promise.resolve();
      return exporter.getFinishedLogRecords();
    },
  };
}
