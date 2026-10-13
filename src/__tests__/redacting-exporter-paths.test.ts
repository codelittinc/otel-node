import { describe, expect, it } from "vitest";
import { SpanKind, type Attributes } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { RedactingSpanExporter } from "../redacting-exporter.js";

const TOKEN = "3f2b8c1e-9a4d-4e6f-b1a2-7c8d9e0f1a2b";

function exportSpan(kind: SpanKind, attributes: Attributes, name = "GET") {
  const memory = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(new RedactingSpanExporter(memory))],
  });
  const span = provider.getTracer("t").startSpan(name, { kind, attributes });
  span.addEvent("retry", { "url.full": `https://api.test/v1/applications/by-token/${TOKEN}` });
  span.end();
  return memory.getFinishedSpans()[0]!;
}

// WHY: a bearer token in a URL path survives query stripping. The applicant's intake token
// (`/apply/<token>` on web, `/v1/applications/by-token/<token>` on the api) opens and submits
// the application for anyone who reads it out of a trace.
describe("RedactingSpanExporter — token-bearing paths", () => {
  it("replaces the path in every URL attribute with the server span's route template", () => {
    const span = exportSpan(SpanKind.SERVER, {
      "http.route": "/v1/applications/by-token/:token",
      "url.full": `https://api.test/v1/applications/by-token/${TOKEN}?x=1`,
      "url.original": `/v1/applications/by-token/${TOKEN}`,
      "url.path": `/v1/applications/by-token/${TOKEN}`,
      "http.target": `/v1/applications/by-token/${TOKEN}?x=1`,
      "http.url": `http://api.test:4000/v1/applications/by-token/${TOKEN}`,
    });

    expect(JSON.stringify([span.attributes, span.events])).not.toContain(TOKEN);
    expect(span.attributes).toMatchObject({
      "url.full": "https://api.test/v1/applications/by-token/:token",
      "url.original": "/v1/applications/by-token/:token",
      "url.path": "/v1/applications/by-token/:token",
      "http.target": "/v1/applications/by-token/:token",
      "http.url": "http://api.test:4000/v1/applications/by-token/:token",
    });
  });

  it("uses the web route template for a Next.js span", () => {
    const span = exportSpan(SpanKind.SERVER, {
      "http.route": "/apply/[token]/submitted",
      "http.target": `/apply/${TOKEN}/submitted`,
    });
    expect(span.attributes["http.target"]).toBe("/apply/[token]/submitted");
  });

  it("templates a client span to a token route, which carries no http.route", () => {
    const span = exportSpan(SpanKind.CLIENT, {
      "url.full": `https://api.test/v1/applications/by-token/${TOKEN}/submit`,
      "url.path": `/v1/applications/by-token/${TOKEN}/submit`,
    });

    expect(JSON.stringify(span.attributes)).not.toContain(TOKEN);
    expect(span.attributes["url.full"]).toBe(
      "https://api.test/v1/applications/by-token/:token/submit",
    );
    expect(span.attributes["url.path"]).toBeUndefined();
  });

  it("drops url.path from a client span, whose path no route template covers", () => {
    const span = exportSpan(SpanKind.CLIENT, {
      "url.full": "https://api.stripe.com/v1/customers/cus_123?expand=x",
      "url.path": "/v1/customers/cus_123",
      "network.peer.address": "10.0.0.7",
    });
    expect(span.attributes["url.path"]).toBeUndefined();
    expect(span.attributes["network.peer.address"]).toBeUndefined();
    expect(span.attributes["url.full"]).toBe("https://api.stripe.com/v1/customers/cus_123");
  });

  it("keeps no trace of a token in a server span's url.path once it has a route", () => {
    const span = exportSpan(SpanKind.SERVER, {
      "url.path": "/v1/applications/by-token/SECRET",
      "http.route": "/v1/applications/by-token/:token",
    });
    expect(JSON.stringify([span.name, span.attributes, span.events])).not.toContain("SECRET");
    expect(span.attributes["url.path"]).toBe("/v1/applications/by-token/:token");
  });

  it("drops the peer address, which is the caller's IP on a server span", () => {
    const span = exportSpan(SpanKind.SERVER, {
      "http.route": "/v1/tenants",
      "network.peer.address": "203.0.113.9",
      "network.peer.port": 51234,
    });
    expect(span.attributes["network.peer.address"]).toBeUndefined();
    expect(span.attributes["network.peer.port"]).toBe(51234);
  });

  it("templates a web page path on a span with no route", () => {
    const span = exportSpan(SpanKind.SERVER, { "http.target": `/apply/${TOKEN}?search=Jane` });
    expect(span.attributes["http.target"]).toBe("/apply/[token]");
  });

  it("drops an unmatched span's url.path and keeps url.full without its query", () => {
    const span = exportSpan(SpanKind.SERVER, {
      "http.route": "unmatched",
      "url.full": "https://api.test/v1/leases/abc-123?search=Jane",
      "url.path": "/v1/leases/abc-123",
    });
    expect(span.attributes["url.full"]).toBe("https://api.test/v1/leases/abc-123");
    expect(span.attributes["url.path"]).toBeUndefined();
  });

  it("leaves a path that only mentions the word apply elsewhere", () => {
    const span = exportSpan(SpanKind.CLIENT, {
      "url.full": "https://x.test/v1/leases/abc/apply/credit",
    });
    expect(span.attributes["url.full"]).toBe("https://x.test/v1/leases/abc/apply/credit");
  });
});

// WHY: Next.js names its root span `${method} ${req.url}` and renames it only when a route
// resolves. An unrouted request (a 404 under /apply/<token>) exports the raw URL, query
// included, as the span name and as `next.span_name`.
describe("RedactingSpanExporter — span names", () => {
  it.each([
    ["GET /apply/tok_SECRET/unknown?x=1", "GET /apply/[token]/unknown"],
    [
      "GET https://api.test/v1/applications/by-token/tok_SECRET?x=1",
      "GET https://api.test/v1/applications/by-token/:token",
    ],
    ["GET /v1/foo?search=Jane%20Doe", "GET /v1/foo"],
    ["POST https://user:pass@api.test/v1/x#frag", "POST https://api.test/v1/x"],
  ])("scrubs %s in the name and next.span_name", (name, expected) => {
    const span = exportSpan(SpanKind.SERVER, { "next.span_name": name }, name);

    expect(span.name).toBe(expected);
    expect(span.attributes["next.span_name"]).toBe(expected);
    expect(JSON.stringify([span.name, span.attributes])).not.toMatch(/tok_SECRET|Jane|pass/);
  });

  it("uses the route template for the name when the span has one", () => {
    const span = exportSpan(
      SpanKind.SERVER,
      { "http.route": "/apply/[token]" },
      "GET /apply/tok_SECRET?x=1",
    );
    expect(span.name).toBe("GET /apply/[token]");
  });

  it.each([
    "GET",
    "outbox.process x",
    "GET /v1/applications/by-token/:token",
    "render route (app) /apply/[token]",
  ])("leaves %s unchanged", (name) => {
    expect(exportSpan(SpanKind.INTERNAL, {}, name).name).toBe(name);
  });
});
