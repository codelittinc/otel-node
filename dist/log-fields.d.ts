/** Returns the active span's `trace_id` and `span_id`, or `{}` when there is no active span. */
export declare function traceLogFields(): {
    trace_id?: string;
    span_id?: string;
};
