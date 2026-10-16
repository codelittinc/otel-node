import { describePatterns } from "./scrub-descriptor.js";

/**
 * Paths whose segments are bearer secrets, with the template each becomes. Anchored at the start
 * of the path. An applicant intake token opens and submits an application for whoever holds it:
 * the web page (`/apply/[token]`) and the api routes it calls. Any letter case and any run of `/`
 * match, as a server routes them alike. A Slack incoming webhook (`/services/<team>/<bot>/<secret>`)
 * is host-agnostic like the rest: all three segments are replaced, the last two being the secret.
 */
export const TOKEN_PATH_TEMPLATES: readonly (readonly [RegExp, string])[] = Object.freeze([
  Object.freeze([/^\/+v1\/+applications\/+by-token\/+[^/?#]+/i, "/v1/applications/by-token/:token"] as const),
  Object.freeze([/^\/+apply\/+[^/?#]+/i, "/apply/[token]"] as const),
  Object.freeze([/^\/+services(?:\/+[^/?#]+){3}/i, "/services/[webhook]"] as const),
]);

// A `scheme:` chain and `//`, or a bare `//`, then the host.
const ORIGIN = /^((?:[a-z][a-z0-9+.-]*:)*\/\/[^/?#]*)(.*)$/is;

// An `http.route` is a template only when it is a path.
const ROUTE_TEMPLATE_PREFIX = "/";

/** Pinned by scrub-contract.test.ts: the agent's layer-2 span scrub repeats these. */
export const URL_PATH_PATTERNS = describePatterns({ ORIGIN });
export const URL_PATH_LITERALS = Object.freeze({ ROUTE_TEMPLATE_PREFIX });
export const TOKEN_PATH_CONTRACT = Object.freeze(
  TOKEN_PATH_TEMPLATES.map(([pattern, replacement]) =>
    Object.freeze({ source: pattern.source, flags: pattern.flags, replacement }),
  ),
);

/** Splits `scheme://host/path` or `//host/path` into its origin and the rest; a path has none. */
function splitOrigin(value: string): [string, string] {
  const match = ORIGIN.exec(value);
  return match ? [match[1]!, match[2]!] : ["", value];
}

function templatePath(path: string, tokenPaths: readonly (readonly [RegExp, string])[]): string {
  return tokenPaths.reduce((out, [pattern, template]) => out.replace(pattern, template), path);
}

/**
 * The URL with its path replaced by the route template when there is one, else with any token
 * segment templated. The origin is kept; the query and fragment are the caller's to strip. A
 * leading `//` may open a path rather than a host, so it is never kept beside a route, and a
 * token path right after it is templated as a path. Leading whitespace is kept as it is.
 */
export function templateUrlPath(
  value: string,
  route: string | undefined,
  tokenPaths: readonly (readonly [RegExp, string])[] = TOKEN_PATH_TEMPLATES,
): string {
  const url = value.trimStart();
  const lead = value.slice(0, value.length - url.length);
  const [origin, rest] = splitOrigin(url);
  if (origin.startsWith("/")) {
    if (route) return `${lead}${route}`;
    const asPath = templatePath(url, tokenPaths);
    if (asPath !== url) return `${lead}${asPath}`;
  }
  if (route) return `${lead}${origin}${route}`;
  return `${lead}${origin}${templatePath(rest, tokenPaths)}`;
}

/** A usable route template: a path, and not the shared label for unmatched requests. */
export function routeTemplateOf(route: unknown): string | undefined {
  return typeof route === "string" && route.startsWith(ROUTE_TEMPLATE_PREFIX) ? route : undefined;
}
