import { ROOT_CONTEXT } from "@opentelemetry/api";
/**
 * BullMQ operations a Worker repeats for its whole life. `startStalledCheckTimer` starts the
 * stalled-check loop inside its own span and returns, so without this every
 * `moveStalledJobsToWait` (every 30 s, per queue) would join that one trace, which would grow
 * until Tempo refuses it (`trace_too_large`).
 */
const LOOP_OPERATIONS = ["moveStalledJobsToWait"];
function isLoopSpan(name) {
    return LOOP_OPERATIONS.some((op) => name === op || name.startsWith(`${op} `));
}
/**
 * Wraps a BullMQ adapter so each iteration of a lifelong loop is a trace of its own. A span given
 * an explicit context (a job's propagated parent) keeps it.
 */
export function rootLoopSpans(telemetry) {
    const { tracer } = telemetry;
    return {
        tracer: {
            startSpan: (name, options, context) => tracer.startSpan(name, options, context ?? (isLoopSpan(name) ? ROOT_CONTEXT : undefined)),
        },
        contextManager: telemetry.contextManager,
        meter: telemetry.meter,
    };
}
