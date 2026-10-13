import { startedBullmqTelemetry } from "./sdk.js";
/**
 * BullMQ telemetry adapter for a Queue or Worker `telemetry` option. Undefined until
 * telemetry has started, which leaves BullMQ on its untraced code path.
 */
export function bullmqTelemetry() {
    return startedBullmqTelemetry();
}
