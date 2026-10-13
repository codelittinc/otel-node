import type { ExportResult } from "@opentelemetry/core";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";
type TokenPaths = readonly (readonly [RegExp, string])[];
/** Pinned by scrub-contract.test.ts: the agent's layer-2 span scrub repeats it. */
export declare const EXPORTER_LITERALS: Readonly<{
    REDACTED_STATUS_KEY: "message";
}>;
export declare class RedactingSpanExporter implements SpanExporter {
    private readonly inner;
    private readonly tokenPaths;
    /** `tokenPaths` are the path patterns templated on spans without a route template. */
    constructor(inner: SpanExporter, tokenPaths?: TokenPaths);
    export(spans: ReadableSpan[], done: (result: ExportResult) => void): void;
    shutdown(): Promise<void>;
    forceFlush(): Promise<void>;
}
export {};
