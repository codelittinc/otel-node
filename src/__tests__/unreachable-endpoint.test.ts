import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, describe, expect, it, vi } from "vitest";
import { trace } from "@opentelemetry/api";
import { log } from "../shared-log.js";
import { isTelemetryStarted, shutdownTelemetry, startTelemetry } from "../sdk.js";

const UNREACHABLE = "http://127.0.0.1:9";

function serve(): Promise<Server> {
  const server = createServer((_req, res) => {
    trace.getTracer("probe").startActiveSpan("handler", (span) => {
      log.info({ event: "request_handled" }, "handled");
      span.end();
      res.end("ok");
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

function timedRequest(server: Server): Promise<number> {
  const { port } = server.address() as AddressInfo;
  const started = performance.now();
  return new Promise((resolve, reject) => {
    request({ host: "127.0.0.1", port, agent: false }, (res) => {
      res.resume();
      res.on("end", () => resolve(performance.now() - started));
    })
      .on("error", reject)
      .end();
  });
}

async function slowest(server: Server, count: number): Promise<number> {
  let worst = 0;
  for (let i = 0; i < count; i++) worst = Math.max(worst, await timedRequest(server));
  return worst;
}

afterAll(async () => {
  await shutdownTelemetry(1_000);
  vi.unstubAllEnvs();
});

// WHY: a dead collector must cost a request nothing it waits on: every export is batched and
// asynchronous, so the request path never blocks on a connection that will not open.
describe("an unreachable endpoint", () => {
  it("delays a request by at most 50 ms", async () => {
    const server = await serve();
    try {
      await timedRequest(server);
      const baseline = await slowest(server, 5);

      vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", UNREACHABLE);
      await startTelemetry({
        serviceName: "acp-api",
        esmLoaderHook: false,
        env: { OTEL_EXPORTER_OTLP_ENDPOINT: UNREACHABLE, OTEL_LOG_LEVEL: "NONE" },
      });
      expect(isTelemetryStarted()).toBe(true);
      // Fill a log batch (64) and a span batch (512) so exports to the dead collector are in flight.
      for (let i = 0; i < 600; i++) trace.getTracer("probe").startSpan("filler").end();
      for (let i = 0; i < 70; i++) log.info({ event: "filler" }, "filler");
      await new Promise((resolve) => setTimeout(resolve, 20));

      const withTelemetry = await slowest(server, 20);
      expect(withTelemetry - baseline).toBeLessThanOrEqual(50);
    } finally {
      server.close();
    }
  }, 15_000);
});
