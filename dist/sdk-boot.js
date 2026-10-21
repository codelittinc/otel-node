import { register } from "node:module";
import { createAddHookMessageChannel } from "import-in-the-middle";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-proto";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { logs } from "@opentelemetry/api-logs";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_INSTANCE_ID, ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION, } from "@opentelemetry/semantic-conventions";
import { BullMQOtel } from "bullmq-otel";
import { rootLoopSpans } from "./bullmq-loops.js";
import { buildInstrumentations } from "./instrumentations.js";
import { metricViews } from "./metric-views.js";
import { RedactingSpanExporter } from "./redacting-exporter.js";
import { logSafely } from "./log-safely.js";
import { setLogLineSink } from "./log-sink.js";
import { logLineSink, ScopedLogRecordProcessor } from "./log-otlp.js";
/** Longest boot waits for the loader thread to acknowledge the hook registration. */
const HOOK_ACK_TIMEOUT_MS = 5_000;
/**
 * Log records per OTLP request. Alloy refuses a whole request over 32 MiB
 * (`agent/config/base.alloy` in codelittinc/carbon-observability), and the logger does not cap a
 * line, so a batch is bounded by count: 64 records stay under the limit unless they average over
 * 512 KiB each. The SDK default of 512 would fail at 64 KiB each.
 */
const LOG_EXPORT_BATCH_SIZE = 64;
/**
 * Registers the ESM loader hook (unless `esmLoaderHook` is false) and starts the Node SDK. Loaded
 * only once telemetry is enabled, so a process without an endpoint never pays for the SDK and its
 * instrumentations. With `exportLogs`, every line the shared logger writes is also sent over OTLP
 * under `logScope`.
 */
export async function bootSdk(config, options) {
    const { logScope, esmLoaderHook = true, exportLogs = true } = options;
    // A message channel limits import-in-the-middle to modules the instrumentations register,
    // instead of wrapping every ESM module the app loads.
    const hook = esmLoaderHook ? createAddHookMessageChannel() : undefined;
    if (hook)
        register("import-in-the-middle/hook.mjs", import.meta.url, hook.registerOptions);
    const sdk = new NodeSDK({
        resource: resourceFromAttributes({
            [ATTR_SERVICE_NAME]: config.serviceName,
            [ATTR_SERVICE_VERSION]: config.serviceVersion,
            [ATTR_SERVICE_INSTANCE_ID]: config.serviceInstanceId,
            "deployment.environment.name": config.environment,
        }),
        spanProcessors: [new BatchSpanProcessor(new RedactingSpanExporter(new OTLPTraceExporter()))],
        metricReaders: [
            new PeriodicExportingMetricReader({
                exporter: new OTLPMetricExporter(),
                exportIntervalMillis: 60_000,
            }),
        ],
        views: metricViews(options.metricViews),
        // Never omitted: an omitted list makes NodeSDK build its own log exporter from env. Records
        // come only from the logger's scrubbed output (see log-otlp.ts), never from an
        // instrumentation that sees a log call before it is scrubbed.
        logRecordProcessors: exportLogs
            ? [
                new ScopedLogRecordProcessor(new BatchLogRecordProcessor({
                    exporter: new OTLPLogExporter(),
                    maxExportBatchSize: LOG_EXPORT_BATCH_SIZE,
                }), logScope),
            ]
            : [],
        instrumentations: buildInstrumentations(options.ignoredPaths ?? [], options.instrumentations),
    });
    sdk.start();
    const booted = {
        shutdown: () => {
            setLogLineSink(undefined);
            // After the records the sink has already queued for emission.
            return Promise.resolve().then(() => sdk.shutdown());
        },
        bullmq: rootLoopSpans(new BullMQOtel({ tracerName: logScope })),
    };
    if (exportLogs)
        setLogLineSink(logLineSink(logs.getLogger(logScope)));
    if (hook)
        await acknowledgedWithin(hook.waitForAllMessagesAcknowledged, HOOK_ACK_TIMEOUT_MS);
    return booted;
}
/**
 * Abandons a loader acknowledgement that never arrives, so boot cannot hang. The wait keeps a
 * referenced interval alive until the ack lands; on timeout it is unreferenced, so an abandoned
 * ack never holds the process open.
 */
async function acknowledgedWithin(wait, timeoutMs) {
    const { result: ack, intervals } = captureIntervals(wait);
    let timer;
    const timeout = new Promise((resolve) => {
        timer = setTimeout(() => resolve("timeout"), timeoutMs);
        timer.unref();
    });
    try {
        if ((await Promise.race([ack, timeout])) === "timeout") {
            for (const interval of intervals)
                interval.unref();
            logSafely("warn", { event: "telemetry_hook_ack_timeout" }, "telemetry_hook_ack_timeout");
        }
    }
    finally {
        clearTimeout(timer);
    }
}
/** Runs `fn` and returns the intervals it created synchronously. */
function captureIntervals(fn) {
    const intervals = [];
    const original = globalThis.setInterval;
    globalThis.setInterval = ((...args) => {
        const interval = original(...args);
        intervals.push(interval);
        return interval;
    });
    try {
        return { result: fn(), intervals };
    }
    finally {
        globalThis.setInterval = original;
    }
}
