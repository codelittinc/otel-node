/** Trace correlation fields for the active span; empty outside a valid span. */
export declare function traceLogFields(): {
    trace_id?: string;
    span_id?: string;
};
