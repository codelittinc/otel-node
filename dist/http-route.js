import { context, trace } from "@opentelemetry/api";
import { getRPCMetadata, RPCType } from "@opentelemetry/core";
import { logScope } from "./options.js";
/**
 * Labels the active HTTP server span and its request metrics with a route template, and tags the
 * span with `<logScope>.request_id`. Call it once routing has finished; a no-op when no span or
 * HTTP context is active.
 */
export function setHttpRoute(route, method, requestId) {
    const rpc = getRPCMetadata(context.active());
    if (rpc?.type === RPCType.HTTP)
        rpc.route = route;
    const span = trace.getActiveSpan();
    span?.updateName(`${method} ${route}`);
    if (requestId)
        span?.setAttribute(`${logScope()}.request_id`, requestId);
}
