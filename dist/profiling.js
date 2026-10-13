import { logSafely } from "./log-safely.js";
let profiler;
/**
 * Starts Pyroscope CPU and heap profiling. Gated on `PYROSCOPE_SERVER_ADDRESS` alone, so it
 * is independent of the OTLP endpoint, and `OTEL_SDK_DISABLED=true` still switches it off.
 * Tags are `env` and `version` only; request-scoped labels would carry identifiers. Never
 * rejects: a missing native binary logs `profiling_start_failed` and returns false.
 */
export async function startProfiling(config, env = process.env) {
    try {
        if (profiler)
            return true;
        const serverAddress = env.PYROSCOPE_SERVER_ADDRESS?.trim();
        if (!serverAddress)
            return false;
        if (env.OTEL_SDK_DISABLED?.trim().toLowerCase() === "true")
            return false;
        const module = await import("@pyroscope/nodejs");
        const pyroscope = module.default ?? module;
        pyroscope.init({
            serverAddress,
            appName: config.serviceName,
            tags: { env: config.environment, version: config.serviceVersion },
            // Pins the 0.6.4 defaults: 60 s flush, 100 Hz wall sampling, one heap sample per 512 KiB.
            flushIntervalMs: 60_000,
            wall: { samplingDurationMs: 60_000, samplingIntervalMicros: 10_000 },
            heap: { samplingIntervalBytes: 512 * 1024, stackDepth: 64 },
        });
        pyroscope.start();
        profiler = pyroscope;
        return true;
    }
    catch (error) {
        profiler = undefined;
        logSafely("warn", { err: error, event: "profiling_start_failed" }, "profiling_start_failed");
        return false;
    }
}
/** Stops the profiler; never rejects. */
export async function stopProfiling() {
    const running = profiler;
    profiler = undefined;
    if (!running)
        return;
    try {
        await running.stop();
    }
    catch {
        // shutdown proceeds regardless
    }
}
