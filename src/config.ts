import { randomUUID } from "node:crypto";

export type TelemetryEnv = Partial<Record<string, string>>;

export interface TelemetryConfig {
  enabled: boolean;
  serviceName: string;
  serviceVersion: string;
  environment: string;
  serviceInstanceId: string;
}

/** One id per process, so every signal from this process names the same instance. */
const PROCESS_INSTANCE_ID = randomUUID();

/** Telemetry exports only when an OTLP endpoint is set; local runs, CI and tests stay silent. */
export function resolveTelemetryConfig(
  fallbackServiceName: string,
  env: TelemetryEnv = process.env,
): TelemetryConfig {
  const endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  const killed = env.OTEL_SDK_DISABLED?.trim().toLowerCase() === "true";
  return {
    enabled: Boolean(endpoint) && !killed,
    serviceName: env.OTEL_SERVICE_NAME?.trim() || fallbackServiceName,
    // A `railway up` deploy carries no commit SHA; the deployment id still pins it.
    serviceVersion:
      env.RAILWAY_GIT_COMMIT_SHA?.trim() || env.RAILWAY_DEPLOYMENT_ID?.trim() || "unknown",
    environment: env.RAILWAY_ENVIRONMENT_NAME?.trim() || "unknown",
    // Splits runtime panels by replica; Prometheus maps it to the `instance` label.
    serviceInstanceId: env.RAILWAY_REPLICA_ID?.trim() || PROCESS_INSTANCE_ID,
  };
}
