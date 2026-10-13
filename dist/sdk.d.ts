import { type TelemetryConfig } from "./config.js";
import { type TelemetryOptions } from "./options.js";
/**
 * Boots the OpenTelemetry Node SDK. Never rejects: a failed start is logged and the config
 * is returned. Telemetry starts once per process; a restart after `shutdownTelemetry` is not
 * supported (shutdown resets state only so tests can run in sequence). The ESM loader hook is
 * registered here, so this module must run under `node --import` before the app loads `http`.
 * The SDK itself is imported only once telemetry is enabled. A host that runs bundled CommonJS
 * (Next.js) passes `esmLoaderHook: false`. The log scope, `redactKeys` and `onError` apply even
 * when export is off, since they shape stdout and error reporting too.
 */
export declare function startTelemetry(options: TelemetryOptions): Promise<TelemetryConfig>;
/** True once `startTelemetry` has booted the SDK in this process. */
export declare function isTelemetryStarted(): boolean;
/**
 * The BullMQ adapter built by `startTelemetry`; undefined until telemetry has started. Typed
 * `unknown` so this module's types never name bullmq; `./bullmq` gives it its type.
 */
export declare function startedBullmqTelemetry(): unknown;
/**
 * Flushes pending spans, metrics, log records and profiles, bounded so a dead collector cannot
 * stall a shutdown.
 */
export declare function shutdownTelemetry(timeoutMs?: number): Promise<void>;
