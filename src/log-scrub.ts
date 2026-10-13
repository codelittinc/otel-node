import { describePatterns } from "./scrub-descriptor.js";
import {
  HOST_PORT,
  QUERY_START,
  QUOTE_END,
  scrubUrls,
  USERINFO_QUOTE,
  URL_END,
  URL_START,
  URL_TOKEN,
  USERINFO_END,
} from "./url-credentials.js";

// Every pattern here can start a match only at a bounded set of positions (an `@`, the start of a
// run, a newline), so each scrub is linear in the input length. A pattern that may start anywhere
// in a long run rescans the run from every position and blocks the event loop for seconds. URL
// userinfo and query removal live in url-credentials.ts.
const SSN_SHAPE = /\b\d{3}-\d{2}-\d{4}\b/g;
// An email's domain, matched at its `@`. The TLD must be alphabetic, so a pnpm store path
// (`.pnpm/hono+node-server@1.19.5/...`) is not an email.
const EMAIL_DOMAIN = /@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g;
const EMAIL_LOCAL_CHAR = /[A-Za-z0-9._%+-]/;
// Eight or more digits standing alone: an account or card number. A UUID group or a prefixed
// provider id (`pi_12345678`) touches a letter, `_` or `-`, so it is not matched.
const LONG_DIGIT_RUN = /(?<![\w-])\d{8,}(?![\w-])/g;
// A newline, then more whitespace, then `at `, matched from the start of its whitespace run.
const FRAME_START = /(?<!\s)[^\S\n]*\n\s+at /;
const REDACTED = "[redacted]";
// An absolute path after whitespace loses its path parameters, query and fragment.
const PATH_IN_TEXT = /(^|\s)(\/[^\s?#;]*)[?#;]\S*/g;

/** Pinned by scrub-contract.test.ts: the agent's layer-2 scrub repeats these patterns. */
export const LOG_SCRUB_PATTERNS = describePatterns({
  SSN_SHAPE,
  EMAIL_DOMAIN,
  EMAIL_LOCAL_CHAR,
  LONG_DIGIT_RUN,
  URL_TOKEN,
  URL_START,
  USERINFO_END,
  URL_END,
  QUOTE_END,
  USERINFO_QUOTE,
  HOST_PORT,
  QUERY_START,
  PATH_IN_TEXT,
});

/**
 * Replaces every email with `[redacted]`. The local part is the run of local-part characters
 * before the `@`, starting no earlier than the end of the previous email.
 */
function replaceEmails(text: string): string {
  let out = "";
  let last = 0;
  EMAIL_DOMAIN.lastIndex = 0;
  for (let m = EMAIL_DOMAIN.exec(text); m !== null; m = EMAIL_DOMAIN.exec(text)) {
    let start = m.index;
    while (start > last && EMAIL_LOCAL_CHAR.test(text[start - 1]!)) start--;
    if (start === m.index) {
      EMAIL_DOMAIN.lastIndex = m.index + 1;
      continue;
    }
    out += text.slice(last, start) + REDACTED;
    last = m.index + m[0].length;
  }
  return out + text.slice(last);
}

/**
 * Replaces SSN and email shapes in free text, strips the userinfo, query and fragment from any URL
 * it quotes and the query and fragment from an absolute path. Phone and account shapes are left
 * alone (id false positives).
 */
export function scrubMessage(text: string): string {
  return replaceEmails(scrubUrls(text).replace(PATH_IN_TEXT, "$1$2").replace(SSN_SHAPE, REDACTED));
}

/** Error text comes from libraries and providers, so standalone long digit runs go too. */
export function scrubErrorText(text: string): string {
  return scrubMessage(text).replace(LONG_DIGIT_RUN, REDACTED);
}

/** Scrubs the header line(s) of a stack and keeps every `at` frame byte for byte. */
export function scrubStack(stack: string, header?: string): string {
  const match = FRAME_START.exec(stack);
  const at = match ? match.index + match[0].indexOf("\n") : -1;
  const frames = at === -1 ? "" : stack.slice(at);
  const head = header ?? (at === -1 ? stack : stack.slice(0, at));
  return `${scrubErrorText(head)}${frames}`;
}
