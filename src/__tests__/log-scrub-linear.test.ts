import { describe, expect, it } from "vitest";
import { scrubErrorText, scrubMessage, scrubStack } from "../log-scrub.js";
import { stripQuery } from "../redact.js";
import { createTestLogger } from "../testing.js";

const SIZE = 200_000;
/** Generous: a linear scrub of 200 KB takes a few milliseconds; a quadratic one takes minutes. */
const BOUND_MS = 100;

function repeat(unit: string, size = SIZE): string {
  return unit.repeat(Math.ceil(size / unit.length)).slice(0, size);
}

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Long runs that hold no complete email, URL, SSN or stack frame, each a backtracking trap. */
const ADVERSARIAL: Record<string, string> = {
  letters: repeat("a"),
  dotted: repeat("a."),
  base64: Array.from({ length: SIZE }, (_, i) => BASE64[(i * 7919) % 64]).join(""),
  "email-ish without @": repeat("a.b-c_d%e+"),
  "repeated a@": repeat("a@"),
  "repeated a@a.": repeat("a@a."),
  "domain without a TLD": `x@${repeat("a.a1")}`,
  "http-ish": repeat("http"),
  "scheme colons": repeat("http:"),
  "repeated a://": repeat("a://"),
  "digit-letter": repeat("1a"),
  digits: repeat("1"),
  "slash path": repeat("/a"),
  "spaced paths": repeat(" /a"),
  newlines: repeat("\n"),
  "newline-space": repeat("\n "),
  spaces: repeat(" "),
  "hyphenated runs": repeat("a-1."),
  "many @, // and ://": repeat('u:p@//a://b@:1/?@"//'),
  "userinfo with no @": `x://u:${repeat("p/")}`,
  "port-like digits": `x://u:${repeat("1")}`,
  "@ runs after a delimiter": `x://u:p/${repeat("@a")}`,
  'dense @ // :// : [ "': repeat('[u:p@//a:"b://[:1@"//:[@,//x?#'),
  "nested // with no @": `x://${repeat("u:p,//")}`,
  "heads before one far @": `x://${repeat(",//a:1/,//b?")}@h`,
  "quotes, backslashes and tabs": repeat(`x://u:"p'\\/\\/@\t:1#=;a:/`),
  "soft spaces before one far @": `x://${repeat("u:p\t\u00a0")}@h`,
};

const MILLION = 1_000_000;
const DENSE_MILLION = '[u:p@//a:"b://[:1@"//:[@,//x?#\'\\/\t;h:/'
  .repeat(Math.ceil(MILLION / 20))
  .slice(0, MILLION);

/** The fastest of three runs: a GC pause or a busy CI worker slows one run, never all three. */
function bestOfThree(fn: () => unknown): number {
  let best = Infinity;
  for (let i = 0; i < 3; i++) {
    const start = performance.now();
    fn();
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

// WHY: the scrubbers run on every log line, with telemetry on or off. A regex that rescans a long
// run from every start position blocks the event loop for seconds on one large value.
describe("scrubbing stays linear on long strings", () => {
  const scrubbers = {
    scrubMessage,
    scrubErrorText,
    scrubStack: (s: string) => scrubStack(s),
    stripQuery,
  };
  for (const [name, scrub] of Object.entries(scrubbers)) {
    it.each(Object.entries(ADVERSARIAL))(`${name}: %s`, (_, input) => {
      expect(bestOfThree(() => scrub(input))).toBeLessThan(BOUND_MS);
    });
  }

  it("scrubs a 1M-character dense input in linear time", () => {
    for (const scrub of Object.values(scrubbers)) {
      expect(bestOfThree(() => scrub(DENSE_MILLION))).toBeLessThan(5 * BOUND_MS);
    }
  });

  it("logs a 200 KB message, field and Error without stalling", () => {
    const { logger, records } = createTestLogger();
    const big = ADVERSARIAL.letters!;
    expect(bestOfThree(() => logger.info(big))).toBeLessThan(5 * BOUND_MS);
    expect(bestOfThree(() => logger.info({ detail: big }, "x"))).toBeLessThan(5 * BOUND_MS);
    expect(bestOfThree(() => logger.error({ err: new Error(big) }, "x"))).toBeLessThan(
      5 * BOUND_MS,
    );
    expect(records).toHaveLength(9);
  });
});
