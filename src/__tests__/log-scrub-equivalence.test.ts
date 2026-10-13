import { describe, expect, it } from "vitest";
import { scrubErrorText, scrubMessage, scrubStack } from "../log-scrub.js";
import { stripQuery } from "../redact.js";
import { samples } from "./scrub-samples.js";

// The scrub written plainly: correct, but quadratic on long runs. Short inputs keep it fast here.
const REFERENCE = {
  ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
  email: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g,
  digits: /(?<![\w-])\d{8,}(?![\w-])/g,
  path: /(^|\s)(\/[^\s?#;]*)[?#;]\S*/g,
  frame: /\n\s+at /,
};

const SCHEME_CHAR = /[a-z0-9+.-]/i;
const NOT_A_DELIMITER = /[\w.~%+:/@-]/;
const HARD_END = "`<>";
const isSpace = (char: string) => /\s/.test(char);

/** The end of the scheme-character run at `i`, when it holds a letter; else -1. */
function schemeRun(token: string, i: number): number {
  let run = i;
  while (run < token.length && SCHEME_CHAR.test(token[run]!)) run++;
  return /[a-z]/i.test(token.slice(i, run)) ? run : -1;
}

/** The first URL at or after `from`, as [start, authority start]. */
function nextUrlStart(token: string, from: number): [number, number] | undefined {
  for (let i = from; i < token.length; i++) {
    const before = token[i - 1];
    if (i === 0 || !SCHEME_CHAR.test(before!)) {
      const run = schemeRun(token, i);
      if (run !== -1 && token.startsWith("://", run)) return [i, run + 3];
      if (run !== -1 && token.startsWith(":\\/\\/", run)) return [i, run + 5];
    }
    if (i === 0 || !NOT_A_DELIMITER.test(before!)) {
      const run = schemeRun(token, i);
      if (run !== -1 && token.startsWith(":/", run) && token[run + 2] !== "/") return [i, run + 2];
      if (token.startsWith("//", i)) return [i, i + 2];
    }
  }
  return undefined;
}

/** A quote at the token's end or before whitespace or a JSON or list delimiter. */
function isQuoteEnd(token: string, i: number): boolean {
  if (token[i] !== '"' && token[i] !== "'") return false;
  return i + 1 === token.length || /[\s,;:}\])>"'&]/.test(token[i + 1]!);
}

function firstIndex(token: string, from: number, ends: (i: number) => boolean): number {
  let i = from;
  while (i < token.length && !ends(i)) i++;
  return i;
}

/** A bracketed host, or a non-empty host with no `:` or bracket, then nothing or `:` and digits. */
function isHostAndPort(head: string): boolean {
  if (head.startsWith("[")) {
    const close = head.indexOf("]");
    return close !== -1 && /^(:\d*)?$/.test(head.slice(close + 1));
  }
  const colon = head.indexOf(":");
  const host = colon === -1 ? head : head.slice(0, colon);
  const port = colon === -1 ? "" : head.slice(colon + 1);
  return host !== "" && !host.includes("[") && !host.includes("]") && /^\d*$/.test(port);
}

/** The userinfo's length at the start of a URL's authority text. */
function userinfoLength(url: string): number {
  const at = url.indexOf("@");
  if (at === -1) return 0;
  const delimiter = url.search(/[/?#\\]/);
  if (delimiter !== -1 && delimiter < at) {
    const head = url.slice(0, delimiter);
    if (head.includes(":") || head.startsWith("[")) {
      const evidence =
        head.startsWith("[") ||
        url[delimiter] === "/" ||
        (url[delimiter] === "\\"
          ? url[delimiter + 1] === "/"
          : /[=/]/.test(url.slice(delimiter, at)));
      if (evidence && isHostAndPort(head)) return 0;
    } else if (url.slice(0, at).includes("/")) {
      return 0;
    }
  }
  const after = url.slice(at + 1).search(/[/?#\\]/);
  return url.lastIndexOf("@", after === -1 ? url.length - 1 : at + after) + 1;
}

function referenceUrlToken(token: string): string {
  let next = nextUrlStart(token, 0);
  if (!next) return token;
  let out = token.slice(0, next[0]);
  while (next) {
    const [start, authority] = next;
    const userinfoEnd = firstIndex(
      token,
      authority,
      (i) =>
        HARD_END.includes(token[i]!) ||
        (isQuoteEnd(token, i) && !(token[i] === "'" && ")'".includes(token[i + 1] ?? "-"))),
    );
    const host = authority + userinfoLength(token.slice(authority, userinfoEnd));
    const end = firstIndex(
      token,
      host,
      (i) => isSpace(token[i]!) || HARD_END.includes(token[i]!) || isQuoteEnd(token, i),
    );
    let following = nextUrlStart(token, host);
    const url = token.slice(host, following ? Math.min(following[0], end) : end);
    const cut = url.search(/[?#;]/);
    out += token.slice(start, authority);
    let resume = host;
    if (cut !== -1) {
      out += url.slice(0, cut);
      resume = firstIndex(token, host + cut, (i) => isSpace(token[i]!));
      if (following && following[0] < resume) following = nextUrlStart(token, resume);
    }
    out += token.slice(resume, following ? following[0] : token.length);
    next = following;
  }
  return out;
}

/** A URL value: userinfo after a leading `scheme:` chain and its slashes, then the query. */
function referenceStripQuery(value: string): string {
  let i = 0;
  while (i < value.length && isSpace(value[i]!)) i++;
  let authority = -1;
  if (value.startsWith("//", i)) {
    authority = i + 2;
  } else {
    let schemes = 0;
    for (let m = /^[0-9+.-]*[a-z][a-z0-9+.-]*:/i.exec(value.slice(i)); m; schemes++) {
      i += m[0].length;
      m = /^[0-9+.-]*[a-z][a-z0-9+.-]*:/i.exec(value.slice(i));
    }
    const slashes = ["//", "/", "\\/\\/"].find((lead) => value.startsWith(lead, i));
    if (schemes > 0 && slashes) authority = i + slashes.length;
  }
  const url =
    authority === -1
      ? value
      : value.slice(0, authority) + value.slice(authority + userinfoLength(value.slice(authority)));
  const cut = url.search(/[?#;]/);
  return cut === -1 ? url : url.slice(0, cut);
}

function referenceMessage(text: string): string {
  return text
    .replace(/[^ \n\r]+/g, referenceUrlToken)
    .replace(REFERENCE.path, "$1$2")
    .replace(REFERENCE.ssn, "[redacted]")
    .replace(REFERENCE.email, "[redacted]");
}

function referenceStack(stack: string): string {
  const match = REFERENCE.frame.exec(stack);
  const frames = match ? stack.slice(match.index) : "";
  const head = match ? stack.slice(0, match.index) : stack;
  return `${referenceMessage(head).replace(REFERENCE.digits, "[redacted]")}${frames}`;
}

// WHY: the linear rewrite must redact exactly what the original patterns redacted, no less.
describe("linear scrub matches the original patterns", () => {
  it("on 20,000 generated strings", () => {
    for (const input of samples(20_000)) {
      expect(scrubMessage(input), JSON.stringify(input)).toBe(referenceMessage(input));
      expect(scrubErrorText(input), JSON.stringify(input)).toBe(
        referenceMessage(input).replace(REFERENCE.digits, "[redacted]"),
      );
      expect(scrubStack(input), JSON.stringify(input)).toBe(referenceStack(input));
      expect(stripQuery(input), JSON.stringify(input)).toBe(referenceStripQuery(input));
    }
  });

  it.each([
    "a@b.com.x@c.com",
    "a@b.com@c.com",
    "x?y=http://h?z",
    "1http://x?q",
    "123://x?q http://y?z",
    "jane@example.com+bob@example.org",
    "foo\n\n  at bar",
    "x \n at y",
    "x\nat jane@example.com",
    "x\n  at jane@example.com",
    "x \t\n\n at jane@x.io 12345678",
    "postgres://u:pw1@pw2.ab@db:5432/x",
    "postgres://u:p?ss@db/x#y",
    "postgres://u:p/ss@db/x",
    "https://host:8080/@handle",
    'x="//u:p@h/x?q",y=http://a:b@c',
    "a://b://c@d?e//f:g@h",
    '{"u":"https://h","e":"a@b.io"}',
    "https://ghp_ab#c@github.com/x",
    "http://[::1]:80/p?u=a@b.com",
    "https://h:/p?u=a@b",
    "postgres://u:p,//x@db/x",
    "postgres://u:ab://c@db/x",
    " jdbc:pg://u:p@h/x?q",
    "postgres://u:it's@db/x",
    '{"d":"pg://u:p\\"x@db/x"}',
    "postgres://admin:2024#S@db/x",
    "https://h/x;j=S",
    "https:/u:p@h/x",
    "pg:\\/\\/u:p@db\\/x",
    "pg://u:p\tq@db/x",
    "pg://app:\\abc/def@db/x",
    "pg://app:c')%22'5@db/x",
  ])("on %j", (input) => {
    expect(scrubMessage(input)).toBe(referenceMessage(input));
    expect(scrubStack(input)).toBe(referenceStack(input));
    expect(stripQuery(input)).toBe(referenceStripQuery(input));
  });
});
