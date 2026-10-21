import type { Telemetry } from "bullmq";
/**
 * Wraps a BullMQ adapter so each iteration of a lifelong loop is a trace of its own. A span given
 * an explicit context (a job's propagated parent) keeps it.
 */
export declare function rootLoopSpans(telemetry: Telemetry): Telemetry;
