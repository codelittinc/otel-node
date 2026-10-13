import { type Context } from "@opentelemetry/api";
import { type Logger } from "@opentelemetry/api-logs";
import type { LogRecordProcessor, SdkLogRecord } from "@opentelemetry/sdk-logs";
import type { LogLineSink } from "./log-sink.js";
/** Body of a line with no message, so a text search in Loki still has something to match. */
export declare const NO_MESSAGE = "(no message)";
/**
 * A sink that turns each line the scrubbing logger wrote into an OTel log record: `msg` (else
 * `event`) is the body, `level` the severity, `time` the timestamp, `trace_id`/`span_id` the record
 * context, every other field an attribute. Only the serialized line is read, so a record holds
 * nothing the line does not. The record is emitted after the line is written, so an SDK diagnostic
 * about it (a dropped attribute) follows the line on stdout instead of preceding it.
 */
export declare function logLineSink(logger: Logger): LogLineSink;
/**
 * Forwards only records from `scope`, the one fed by the scrubbing logger. Any other emitter on
 * the global provider (an instrumentation's raw exception record) is never exported.
 */
export declare class ScopedLogRecordProcessor implements LogRecordProcessor {
    private readonly inner;
    private readonly scope;
    constructor(inner: LogRecordProcessor, scope: string);
    onEmit(record: SdkLogRecord, context?: Context): void;
    enabled(options: Parameters<NonNullable<LogRecordProcessor["enabled"]>>[0]): boolean;
    forceFlush(): Promise<void>;
    shutdown(): Promise<void>;
}
