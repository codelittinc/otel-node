import { diag, DiagLogLevel } from "@opentelemetry/api";
import { resolveTelemetryConfig, type TelemetryConfig, type TelemetryEnv } from "./config.js";
import type { BootedSdk } from "./sdk-boot.js";
import { diagLogger, logSafely } from "./log-safely.js";
import { addSensitiveKeys } from "./log-redact.js";
import { applyOptions, logScope, sameOptions, type TelemetryOptions } from "./options.js";
import { startProfiling, stopProfiling } from "./profiling.js";

let sdk: BootedSdk | undefined;
let started: TelemetryConfig | undefined;
let applied: TelemetryOptions | undefined;

/**
 * Boots the OpenTelemetry Node SDK. Never rejects: a failed start is logged and the config
 * is returned. Telemetry starts once per process; a restart after `shutdownTelemetry` is not
 * supported (shutdown resets state only so tests can run in sequence). The ESM loader hook is
 * registered here, so this module must run under `node --import` before the app loads `http`.
 * The SDK itself is imported only once telemetry is enabled. A host that runs bundled CommonJS
 * (Next.js) passes `esmLoaderHook: false`. The log scope, `redactKeys` and `onError` apply even
 * when export is off, since they shape stdout and error reporting too. The first call's options
 * win whether or not it exported; a later call may only turn export on through its `env`, and
 * warns `telemetry_restart_ignored` when its options differ.
 */
export async function startTelemetry(options: TelemetryOptions): Promise<TelemetryConfig> {
  let effective: TelemetryOptions;
  let env: TelemetryEnv;
  let config: TelemetryConfig;
  try {
    effective = resolveOptions(options);
    if (started) return started;
    env = effective.env ?? process.env;
    config = resolveTelemetryConfig(effective.serviceName, env);
  } catch (error) {
    logSafely("warn", { err: error, event: "telemetry_start_failed" }, "telemetry_start_failed");
    const name = typeof options?.serviceName === "string" ? options.serviceName : "unknown";
    return { ...resolveTelemetryConfig(name, {}), enabled: false };
  }
  if (!config.enabled) {
    await startProfiling(config, env);
    return config;
  }
  started = config;
  installDiagLogger(env.OTEL_LOG_LEVEL);
  try {
    const { bootSdk } = await import("./sdk-boot.js");
    sdk = await bootSdk(config, {
      logScope: logScope(),
      ignoredPaths: effective.ignoredPaths ?? [],
      esmLoaderHook: effective.esmLoaderHook !== false,
      exportLogs: effective.logs !== false,
      metricViews: effective.metricViews,
      instrumentations: effective.instrumentations,
    });
    logSafely(
      "info",
      {
        event: "telemetry_started",
        serviceName: config.serviceName,
        endpointHost: hostOf(env.OTEL_EXPORTER_OTLP_ENDPOINT),
      },
      "telemetry_started",
    );
  } catch (error) {
    sdk = undefined;
    logSafely("warn", { err: error, event: "telemetry_start_failed" }, "telemetry_start_failed");
  }
  await startProfiling(config, env);
  return config;
}

/** The first call's options, applied once; a later call keeps them and only brings its `env`. */
function resolveOptions(options: TelemetryOptions): TelemetryOptions {
  if (applied) {
    if (!sameOptions(applied, options)) {
      logSafely("warn", { event: "telemetry_restart_ignored" }, "telemetry_restart_ignored");
    }
    return { ...applied, env: options.env };
  }
  applyOptions(options);
  if (options.redactKeys) addSensitiveKeys(options.redactKeys);
  applied = options;
  return options;
}

/** True once `startTelemetry` has booted the SDK in this process. */
export function isTelemetryStarted(): boolean {
  return sdk !== undefined;
}

/**
 * The BullMQ adapter built by `startTelemetry`; undefined until telemetry has started. Typed
 * `unknown` so this module's types never name bullmq; `./bullmq` gives it its type.
 */
export function startedBullmqTelemetry(): unknown {
  return sdk?.bullmq;
}

/**
 * Flushes pending spans, metrics, log records and profiles, bounded so a dead collector cannot
 * stall a shutdown.
 */
export async function shutdownTelemetry(timeoutMs = 5_000): Promise<void> {
  started = undefined;
  applied = undefined;
  const running = sdk;
  sdk = undefined;
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs).unref());
  await Promise.race([
    Promise.all([
      stopProfiling(),
      Promise.resolve()
        .then(() => running?.shutdown())
        .catch(() => undefined),
    ]).then(() => undefined),
    timeout,
  ]);
}

/** SDK warnings (a rejected export, a bad option) go through the redacting logger. When
 * `OTEL_LOG_LEVEL` is set, NodeSDK installs its own console logger at that level for debugging,
 * so this default stays out of its way. */
function installDiagLogger(level: string | undefined): void {
  if (level?.trim()) return;
  diag.setLogger(diagLogger, {
    logLevel: DiagLogLevel.WARN,
    suppressOverrideMessage: true,
  });
}

/** The endpoint's host only: a URL can carry credentials in its userinfo or query. */
function hostOf(endpoint: string | undefined): string {
  try {
    return new URL(endpoint?.trim() ?? "").host;
  } catch {
    return "invalid";
  }
}
