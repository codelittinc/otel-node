import { metrics } from "@opentelemetry/api";
/**
 * A meter on the global provider. Obtain it after `startTelemetry`: a meter taken earlier is a
 * no-op and never records, even once telemetry starts.
 */
export function getMeter(name) {
    return metrics.getMeter(name);
}
