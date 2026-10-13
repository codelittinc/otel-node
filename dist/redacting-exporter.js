import { scrubAttributes, scrubSpanName } from "./redact.js";
import { routeTemplateOf, TOKEN_PATH_TEMPLATES } from "./url-path.js";
// The span status field that carries the thrown message; it is kept, redacted, so a failure shows.
const REDACTED_STATUS_KEY = "message";
/** Pinned by scrub-contract.test.ts: the agent's layer-2 span scrub repeats it. */
export const EXPORTER_LITERALS = Object.freeze({ REDACTED_STATUS_KEY });
function scrubSpan(span, tokenPaths) {
    const attributes = scrubAttributes(span.attributes, tokenPaths);
    const name = scrubSpanName(span.name, routeTemplateOf(span.attributes["http.route"]), tokenPaths);
    const events = span.events.map((event) => event.attributes
        ? { ...event, attributes: scrubAttributes(event.attributes, tokenPaths) }
        : event);
    const links = span.links.map((link) => link.attributes ? { ...link, attributes: scrubAttributes(link.attributes, tokenPaths) } : link);
    const status = span.status && span.status[REDACTED_STATUS_KEY]
        ? { ...span.status, [REDACTED_STATUS_KEY]: "[redacted]" }
        : span.status;
    return new Proxy(span, {
        get(target, property) {
            if (property === "name")
                return name;
            if (property === "attributes")
                return attributes;
            if (property === "events")
                return events;
            if (property === "links")
                return links;
            if (property === "status")
                return status;
            const value = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
        },
    });
}
export class RedactingSpanExporter {
    inner;
    tokenPaths;
    /** `tokenPaths` are the path patterns templated on spans without a route template. */
    constructor(inner, tokenPaths = TOKEN_PATH_TEMPLATES) {
        this.inner = inner;
        this.tokenPaths = tokenPaths;
    }
    export(spans, done) {
        this.inner.export(spans.map((span) => scrubSpan(span, this.tokenPaths)), done);
    }
    shutdown() {
        return this.inner.shutdown();
    }
    forceFlush() {
        return this.inner.forceFlush?.() ?? Promise.resolve();
    }
}
