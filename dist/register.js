// `node --import @codelittinc/otel-node/register`: starts telemetry before the app loads, for an
// app with no options to pass. `OTEL_SERVICE_NAME` names the service and is its log scope.
import { startTelemetry } from "./sdk.js";
const serviceName = process.env.OTEL_SERVICE_NAME?.trim() || "unknown";
await startTelemetry({ serviceName, logScope: serviceName });
