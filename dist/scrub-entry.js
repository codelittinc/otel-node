// Browser-safe scrub functions: the same objects the server scrub uses, so a client can never
// drift from it. Imports nothing from Node or OpenTelemetry.
export { scrubMessage, scrubErrorText } from "./log-scrub.js";
export { stripQuery } from "./strip-query.js";
export { TOKEN_PATH_TEMPLATES, templateUrlPath } from "./url-path.js";
