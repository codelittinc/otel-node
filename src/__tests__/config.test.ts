import { describe, expect, it } from "vitest";
import { resolveTelemetryConfig } from "../config.js";

describe("resolveTelemetryConfig", () => {
  it("is disabled when no endpoint is configured", () => {
    expect(resolveTelemetryConfig("api", {}).enabled).toBe(false);
    expect(resolveTelemetryConfig("api", { OTEL_EXPORTER_OTLP_ENDPOINT: "  " }).enabled).toBe(
      false,
    );
  });
  it("is disabled by the standard kill switch even with an endpoint", () => {
    const env = { OTEL_EXPORTER_OTLP_ENDPOINT: "http://c:4318", OTEL_SDK_DISABLED: "TRUE" };
    expect(resolveTelemetryConfig("api", env).enabled).toBe(false);
  });
  it("names the service, version and environment from Railway", () => {
    const config = resolveTelemetryConfig("api", {
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://otel-collector.railway.internal:4318",
      RAILWAY_GIT_COMMIT_SHA: "abc123",
      RAILWAY_ENVIRONMENT_NAME: " cody-dev-env ",
      RAILWAY_REPLICA_ID: " 7f3c-replica ",
    });
    expect(config).toEqual({
      enabled: true,
      serviceName: "api",
      serviceVersion: "abc123",
      environment: "cody-dev-env",
      serviceInstanceId: "7f3c-replica",
    });
  });
  it("prefers OTEL_SERVICE_NAME and falls back to unknown", () => {
    const config = resolveTelemetryConfig("api", { OTEL_SERVICE_NAME: "api-canary" });
    expect(config.serviceName).toBe("api-canary");
    expect(config.serviceVersion).toBe("unknown");
    expect(resolveTelemetryConfig("api", { RAILWAY_DEPLOYMENT_ID: "dep-1" }).serviceVersion).toBe(
      "dep-1",
    );
    expect(config.environment).toBe("unknown");
  });
  it("falls back to one random instance id per process", () => {
    const first = resolveTelemetryConfig("api", {}).serviceInstanceId;
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(resolveTelemetryConfig("worker", { RAILWAY_REPLICA_ID: "  " }).serviceInstanceId).toBe(
      first,
    );
  });
});
