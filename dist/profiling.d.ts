import type { TelemetryConfig, TelemetryEnv } from "./config.js";
/**
 * Starts Pyroscope CPU and heap profiling. Gated on `PYROSCOPE_SERVER_ADDRESS` alone, so it
 * is independent of the OTLP endpoint, and `OTEL_SDK_DISABLED=true` still switches it off.
 * Tags are `env` and `version` only; request-scoped labels would carry identifiers. Never
 * rejects: a missing native binary logs `profiling_start_failed` and returns false.
 */
export declare function startProfiling(config: TelemetryConfig, env?: TelemetryEnv): Promise<boolean>;
/** Stops the profiler; never rejects. */
export declare function stopProfiling(): Promise<void>;
