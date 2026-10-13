/**
 * Labels the active HTTP server span and its request metrics with a route template, and tags the
 * span with `<logScope>.request_id`. Call it once routing has finished; a no-op when no span or
 * HTTP context is active.
 */
export declare function setHttpRoute(route: string, method: string, requestId?: string): void;
