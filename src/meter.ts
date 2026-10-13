import { metrics, type Meter } from "@opentelemetry/api";

/**
 * A meter on the global provider. Obtain it after `startTelemetry`: a meter taken earlier is a
 * no-op and never records, even once telemetry starts.
 */
export function getMeter(name: string): Meter {
  return metrics.getMeter(name);
}

export type { BatchObservableResult, Meter } from "@opentelemetry/api";
