import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { context, INVALID_SPAN_CONTEXT, ROOT_CONTEXT, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { RPCType, setRPCMetadata, type RPCMetadata } from "@opentelemetry/core";
import { setHttpRoute } from "../http-route.js";
import { applyOptions, resetOptions } from "../options.js";

beforeAll(() => {
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  applyOptions({ serviceName: "api", logScope: "backbone" });
});
afterAll(() => {
  context.disable();
  resetOptions();
});

describe("setHttpRoute", () => {
  it("records the route on the HTTP request metadata", () => {
    const rpc: RPCMetadata = {
      type: RPCType.HTTP,
      span: trace.wrapSpanContext(INVALID_SPAN_CONTEXT),
    };
    context.with(setRPCMetadata(ROOT_CONTEXT, rpc), () => setHttpRoute("/v1/leases/:id", "GET"));
    expect(rpc.route).toBe("/v1/leases/:id");
  });

  it("renames the active span and tags the request id", () => {
    const span = {
      updateName: vi.fn(),
      setAttribute: vi.fn(),
      spanContext: () => INVALID_SPAN_CONTEXT,
    };
    context.with(trace.setSpan(ROOT_CONTEXT, span as never), () =>
      setHttpRoute("/v1/leases/:id", "GET", "req-1"),
    );
    expect(span.updateName).toHaveBeenCalledWith("GET /v1/leases/:id");
    expect(span.setAttribute).toHaveBeenCalledWith("backbone.request_id", "req-1");
  });

  it("does nothing without an active span", () => {
    expect(() => setHttpRoute("/x", "GET")).not.toThrow();
  });
});
