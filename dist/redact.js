import { isAppAttributeKey } from "./app-keys.js";
import { scrubMessage } from "./log-scrub.js";
import { describeKeySets, describePatterns } from "./scrub-descriptor.js";
import { stripUserinfo, URL_AUTHORITY } from "./url-credentials.js";
import { routeTemplateOf, templateUrlPath, TOKEN_PATH_TEMPLATES } from "./url-path.js";
const URL_KEYS = new Set(["url.full", "url.original", "http.url", "http.target", "url.path"]);
const DROPPED_KEYS = new Set([
    "url.query",
    "http.request.body",
    "http.response.body",
    "client.address",
    "network.peer.address",
    "bullmq.job.result",
    "bullmq.job.progress",
]);
/** Kept so a failure is visible, but its content is the thrown message. */
const REDACTED_KEYS = new Set(["exception.message", "bullmq.job.failed.reason"]);
const DROPPED_PREFIXES = [
    "http.request.header.",
    "http.response.header.",
    "messaging.message.body",
    "db.query.parameter.",
    "db.operation.parameter.",
    "enduser.",
    "user.",
];
const STATEMENT_KEYS = ["db.statement", "db.query.text"];
// A span with either key set to this is a Redis call, whose statement quotes the values it sent.
const REDIS_SYSTEM_KEYS = ["db.system.name", "db.system"];
const REDIS_SYSTEM = "redis";
const URL_QUERY_START = /[?#;]/;
const FRAME_LINE = /^\s+at /;
/** `schemeless` reads a value with no scheme and no leading `/` as starting at its authority. */
export function stripQuery(url, schemeless = false) {
    // Userinfo first: a password can hold a `?` or `#`.
    const withoutUserinfo = stripUserinfo(url, schemeless);
    const cut = withoutUserinfo.search(URL_QUERY_START);
    return cut === -1 ? withoutUserinfo : withoutUserinfo.slice(0, cut);
}
// `METHOD /path`, `METHOD scheme://host/path` or `METHOD user@host/path`.
const NAMED_REQUEST = /^([A-Z]+) ((?:\/|[a-z][a-z0-9+.-]*:\/\/|[^\s/?#@]*@)\S*)$/i;
const NAME_KEYS = new Set(["next.span_name"]);
const WORD = /\S+/g;
/** Pinned by scrub-contract.test.ts: the agent's layer-2 span scrub repeats these. */
export const REDACT_PATTERNS = describePatterns({
    URL_AUTHORITY,
    URL_QUERY_START,
    NAMED_REQUEST,
    FRAME_LINE,
});
export const REDACT_KEY_SETS = describeKeySets({
    URL_KEYS,
    DROPPED_KEYS,
    REDACTED_KEYS,
    DROPPED_PREFIXES,
    STATEMENT_KEYS,
    NAME_KEYS,
    REDIS_SYSTEM_KEYS,
});
export const REDACT_LITERALS = Object.freeze({ REDIS_SYSTEM });
/**
 * A span name of the form `METHOD /path`, `METHOD scheme://host/path` or `METHOD user@host/path`
 * gets the same treatment as a URL attribute: no query, fragment or userinfo, and the path
 * templated. Next.js names an unrouted request's span after its raw URL. Any other name gets the
 * message scrub, and each of its words its token paths templated.
 */
export function scrubSpanName(name, route, tokenPaths = TOKEN_PATH_TEMPLATES) {
    const match = NAMED_REQUEST.exec(name);
    if (!match) {
        return scrubMessage(name).replace(WORD, (word) => templateUrlPath(word, undefined, tokenPaths));
    }
    return `${match[1]} ${templateUrlPath(stripQuery(match[2], true), route, tokenPaths)}`;
}
function isRedis(attributes) {
    return REDIS_SYSTEM_KEYS.some((key) => attributes[key] === REDIS_SYSTEM);
}
function scrubExceptionStacktrace(stacktrace, exceptionType) {
    const lines = stacktrace.split("\n");
    const type = exceptionType || "Error";
    let frameStartIndex = lines.findIndex((line) => FRAME_LINE.test(line));
    if (frameStartIndex === -1) {
        return `${type}: [redacted]`;
    }
    const result = [`${type}: [redacted]`, ...lines.slice(frameStartIndex)];
    return result.join("\n");
}
/**
 * Scrubs one attribute set. Every URL attribute loses its query, fragment and userinfo, and its
 * path becomes the span's `http.route` template when it has one, so a path parameter never
 * leaves. Without a route (client spans, unmatched requests) `url.path` is dropped and known
 * token-bearing paths are templated in the remaining URL attributes. An attribute named by the
 * app's `redactKeys` (its whole name or last `.` segment) is redacted.
 */
export function scrubAttributes(attributes, tokenPaths = TOKEN_PATH_TEMPLATES) {
    const redis = isRedis(attributes);
    const route = routeTemplateOf(attributes["http.route"]);
    const scrubbed = {};
    for (const [key, value] of Object.entries(attributes)) {
        if (DROPPED_KEYS.has(key) || DROPPED_PREFIXES.some((prefix) => key.startsWith(prefix)))
            continue;
        if (redis && STATEMENT_KEYS.includes(key))
            continue;
        if (key === "url.path" && !route)
            continue;
        if (REDACTED_KEYS.has(key) || isAppAttributeKey(key)) {
            scrubbed[key] = "[redacted]";
        }
        else if (key === "exception.stacktrace") {
            if (typeof value === "string") {
                const exceptionType = attributes["exception.type"];
                scrubbed[key] = scrubExceptionStacktrace(value, exceptionType);
            }
            else {
                scrubbed[key] = "[redacted]";
            }
        }
        else {
            scrubbed[key] =
                typeof value !== "string"
                    ? value
                    : URL_KEYS.has(key)
                        ? templateUrlPath(stripQuery(value, true), route, tokenPaths)
                        : NAME_KEYS.has(key)
                            ? scrubSpanName(value, route, tokenPaths)
                            : value;
        }
    }
    return scrubbed;
}
