import type { Telemetry } from "bullmq";
import type { Instrumentation } from "@opentelemetry/instrumentation";
import type { TelemetryConfig } from "./config.js";
import type { MetricViewOptions } from "./options.js";
export interface BootedSdk {
    shutdown(): Promise<void>;
    bullmq: Telemetry;
}
export interface BootOptions {
    logScope: string;
    ignoredPaths?: readonly string[];
    esmLoaderHook?: boolean;
    exportLogs?: boolean;
    metricViews?: MetricViewOptions;
    instrumentations?: readonly Instrumentation[];
}
/**
 * Registers the ESM loader hook (unless `esmLoaderHook` is false) and starts the Node SDK. Loaded
 * only once telemetry is enabled, so a process without an endpoint never pays for the SDK and its
 * instrumentations. With `exportLogs`, every line the shared logger writes is also sent over OTLP
 * under `logScope`.
 */
export declare function bootSdk(config: TelemetryConfig, options: BootOptions): Promise<BootedSdk>;
