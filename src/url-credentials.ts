// URL userinfo and query removal, shared by the message scrub and the URL value scrub. It imports
// nothing, so a browser bundle can load it from the `./url-credentials` entry.
//
// Every scan moves forward through the text once, so a scrub is linear in the input length.

// Free text splits into URL tokens at a space or a line break only, so a tab or another space
// inside a password does not end its URL.
export const URL_TOKEN = /[^ \n\r]+/g;
// Where a URL's authority starts: after a scheme's `://` or JSON-escaped `:\/\/` (matched from
// the start of its run of scheme characters); after a scheme's `:/`, or a `//`, at the start of a
// token or after a delimiter.
export const URL_START =
  /(?<![a-z0-9+.-])[0-9+.-]*[a-z][a-z0-9+.-]*:(?:\/\/|\\\/\\\/)|(?<![\w.~%+:/@-])(?:[0-9+.-]*[a-z][a-z0-9+.-]*:\/(?!\/)|\/\/)/gi;
// Userinfo ends no later than a backtick, an angle bracket or QUOTE_END, except a USERINFO_QUOTE.
// It never ends at `,`, `;` or whitespace inside a token, which a password may hold.
export const USERINFO_END = /[`<>]/;
// A host and path also end at any whitespace.
export const URL_END = /[\s`<>]/;
// A quote ends a URL only at the token's end or before whitespace or a JSON or list delimiter.
export const QUOTE_END = /["'](?=$|[\s,;:}\])>"'&])/y;
// A `'` before `)` or `'`, which an encoded password keeps raw, does not end userinfo.
export const USERINFO_QUOTE = /'[)']/y;
// Text before an authority's first `/`, `?`, `#` or `\` that reads as a host and an optional port
// (a bracketed IPv6 host, or a non-empty host with no `:`, then `:` and digits or nothing).
export const HOST_PORT = /^(?:\[[^\]]*\]|[^:[\]]+)(?::\d*)?$/;
// The leading `scheme:` chain and one or two `/` (or `\/\/`), or a bare `//`, of a URL value.
export const URL_AUTHORITY = /^\s*(?:(?:[0-9+.-]*[a-z][a-z0-9+.-]*:)+(?:\/\/?|\\\/\\\/)|\/\/)/i;
export const QUERY_START = /[?#;]/;

type Finder = (from: number) => number;

/** The first index at or after `from` whose character passes `test`, or the text's length. */
function finder(text: string, test: (char: string, index: number) => boolean): Finder {
  let lastFrom = -1;
  let found = -1;
  return (from) => {
    // Calls whose `from` never decreases reuse the last result, which keeps a scan linear.
    if (from < lastFrom || found < from) {
      found = from;
      while (found < text.length && !test(text[found]!, found)) found++;
    }
    lastFrom = from;
    return found;
  };
}

const isDelimiter = (char: string) => char === "/" || char === "?" || char === "#" || char === "\\";

interface Scanner {
  at: Finder;
  delimiter: Finder;
  slash: Finder;
  queryValue: Finder;
  delimiterAfterAt: Finder;
}

function scanner(text: string): Scanner {
  return {
    at: finder(text, (char) => char === "@"),
    delimiter: finder(text, isDelimiter),
    slash: finder(text, (char) => char === "/"),
    queryValue: finder(text, (char) => char === "=" || char === "/"),
    delimiterAfterAt: finder(text, isDelimiter),
  };
}

/**
 * Where the authority at `from` continues past its userinfo, which runs to the last `@` before
 * the first `/`, `?`, `#` or `\` after its first `@`, within `end`. Text before a delimiter that
 * comes ahead of the first `@` is a host, not userinfo:
 * - with a `:` or a leading `[`, when HOST_PORT matches and the head is bracketed, the delimiter
 *   is `/` or an escaped `\/`, or a `?` or `#` delimiter has a `=` or `/` after it before the `@`;
 * - with neither, when a `/` comes before the `@`.
 * A `//` or `://` inside userinfo starts no URL. Returns `from` when there is no userinfo.
 */
function afterUserinfo(text: string, from: number, end: number, scan: Scanner): number {
  const at = scan.at(from);
  if (at >= end) return from;
  const delimiter = scan.delimiter(from);
  if (delimiter < at) {
    const head = text.slice(from, delimiter);
    if (head.includes(":") || head.startsWith("[")) {
      const sign = text[delimiter];
      const hostEvidence =
        head.startsWith("[") ||
        sign === "/" ||
        (sign === "\\" ? text[delimiter + 1] === "/" : scan.queryValue(delimiter) < at);
      if (hostEvidence && HOST_PORT.test(head)) return from;
    } else if (scan.slash(delimiter) < at) {
      return from;
    }
  }
  const close = Math.min(scan.delimiterAfterAt(at + 1), end);
  return text.lastIndexOf("@", close - 1) + 1;
}

/**
 * In a URL token, each URL loses its userinfo, and a URL with a `?`, `#` or `;` after its
 * authority loses everything from there to the next whitespace. A host and path run to URL_END,
 * QUOTE_END or the next URL's start, whichever comes first.
 */
export function scrubUrlToken(token: string): string {
  URL_START.lastIndex = 0;
  let start = URL_START.exec(token);
  if (!start) return token;
  const scan = scanner(token);
  const quoteEnds = (char: string, index: number) => {
    if (char !== '"' && char !== "'") return false;
    QUOTE_END.lastIndex = index;
    return QUOTE_END.test(token);
  };
  const keptQuote = (index: number) => {
    USERINFO_QUOTE.lastIndex = index;
    return USERINFO_QUOTE.test(token);
  };
  const userinfoEnd = finder(
    token,
    (char, i) => USERINFO_END.test(char) || (quoteEnds(char, i) && !keptQuote(i)),
  );
  const urlEnd = finder(token, (char, i) => URL_END.test(char) || quoteEnds(char, i));
  const query = finder(token, (char) => QUERY_START.test(char));
  const space = finder(token, (char) => /\s/.test(char));
  let out = token.slice(0, start.index);
  while (start) {
    const authority = start.index + start[0].length;
    const host = afterUserinfo(token, authority, userinfoEnd(authority), scan);
    const end = urlEnd(host);
    URL_START.lastIndex = host;
    let next = URL_START.exec(token);
    const cut = query(host);
    out += token.slice(start.index, authority);
    let resume = host;
    if (cut < (next ? Math.min(next.index, end) : end)) {
      out += token.slice(host, cut);
      resume = space(cut);
      if (next && next.index < resume) {
        URL_START.lastIndex = resume;
        next = URL_START.exec(token);
      }
    }
    out += token.slice(resume, next ? next.index : token.length);
    start = next;
  }
  return out;
}

/** Every URL in free text, scrubbed as `scrubUrlToken` does. */
export function scrubUrls(text: string): string {
  return text.replace(URL_TOKEN, scrubUrlToken);
}

/**
 * A URL value without its userinfo. The authority starts after URL_AUTHORITY. With `schemeless`,
 * a value without one that is not a path starts its authority at its first non-space character.
 * The value is one URL, so its userinfo may run to the value's end.
 */
export function stripUserinfo(value: string, schemeless = false): string {
  const lead = URL_AUTHORITY.exec(value);
  const authority = lead ? lead[0].length : value.length - value.trimStart().length;
  if (!lead && (!schemeless || value.startsWith("/", authority))) return value;
  const host = afterUserinfo(value, authority, value.length, scanner(value));
  return value.slice(0, authority) + value.slice(host);
}
