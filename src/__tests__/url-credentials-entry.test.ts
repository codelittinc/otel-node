import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as scrubEntry from "../scrub-entry.js";
import { scrubErrorText, scrubMessage } from "../log-scrub.js";
import { stripQuery } from "../strip-query.js";
import { TOKEN_PATH_TEMPLATES, templateUrlPath } from "../url-path.js";
import { stripQuery as redactStripQuery } from "../redact.js";

const SRC = new URL("../", import.meta.url);
const IMPORT =
  /\b(?:import|export)\s[^'"]*?from\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']/g;
const NODE_GLOBALS =
  /\b(?:process|Buffer|require|__dirname|__filename|global)\b/;

/** Every module `entry` reaches through static or dynamic imports, with its source. */
function importGraph(entry: string): Map<string, string> {
  const seen = new Map<string, string>();
  const pending = [entry];
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (seen.has(file)) continue;
    const source = readFileSync(new URL(file, SRC), "utf8");
    seen.set(file, source);
    for (const match of source.matchAll(IMPORT)) {
      const specifier = (match[1] ?? match[2] ?? match[3])!;
      if (!specifier.startsWith("./")) {
        seen.set(`external:${specifier}`, "");
        continue;
      }
      pending.push(specifier.replace(/\.js$/, ".ts").slice(2));
    }
  }
  return seen;
}

// WHY: the browser bundles the `./url-credentials` entry. One import of a Node built-in or of
// the OTel SDK would pull server code into a client bundle, or break the build.
describe("the url-credentials entry", () => {
  const graph = importGraph("url-credentials.ts");

  it("imports no package and no Node built-in, only its own files", () => {
    expect(
      [...graph.keys()].filter((key) => key.startsWith("external:")),
    ).toEqual([]);
  });

  it("uses no Node global in any file it reaches", () => {
    for (const [file, source] of graph) {
      const code = source
        .replace(/\/\/.*$/gm, "")
        .replace(/\/\*[\s\S]*?\*\//g, "");
      expect(NODE_GLOBALS.test(code), file).toBe(false);
    }
  });

  it("is exported as its own subpath", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    ) as { exports: Record<string, { default: string }> };
    expect(manifest.exports["./url-credentials"]?.default).toBe(
      "./dist/url-credentials.js",
    );
  });
});

// WHY: the browser bundles the `./scrub` entry for client-side redaction, so it carries the same
// import limits as `./url-credentials`.
describe("the scrub entry", () => {
  const graph = importGraph("scrub-entry.ts");

  it("imports no package and no Node built-in, only its own files", () => {
    expect(
      [...graph.keys()].filter((key) => key.startsWith("external:")),
    ).toEqual([]);
  });

  it("uses no Node global in any file it reaches", () => {
    for (const [file, source] of graph) {
      const code = source
        .replace(/\/\/.*$/gm, "")
        .replace(/\/\*[\s\S]*?\*\//g, "");
      expect(NODE_GLOBALS.test(code), file).toBe(false);
    }
  });

  it("exports the same function objects the server scrub uses", () => {
    expect(scrubEntry.scrubMessage).toBe(scrubMessage);
    expect(scrubEntry.scrubErrorText).toBe(scrubErrorText);
    expect(scrubEntry.stripQuery).toBe(stripQuery);
    expect(scrubEntry.TOKEN_PATH_TEMPLATES).toBe(TOKEN_PATH_TEMPLATES);
    expect(scrubEntry.templateUrlPath).toBe(templateUrlPath);
    expect(redactStripQuery).toBe(stripQuery);
  });

  it("templates a Slack webhook URL through the scrub entry", () => {
    expect(
      scrubEntry.templateUrlPath("https://hooks.slack.com/services/T0A/B0B/SECRET", undefined),
    ).toBe("https://hooks.slack.com/services/[webhook]");
  });

  it("exports a token path list no consumer can change", () => {
    const list = scrubEntry.TOKEN_PATH_TEMPLATES as unknown as unknown[][];
    const before = JSON.stringify(list.map(([re, to]) => [String(re), to]));
    expect(() => list.push([/x/, "y"])).toThrow(TypeError);
    expect(() => list.splice(0, 1)).toThrow(TypeError);
    expect(() => {
      list[0]![1] = "weakened";
    }).toThrow(TypeError);
    expect(JSON.stringify(list.map(([re, to]) => [String(re), to]))).toBe(
      before,
    );
  });

  it("is exported as its own subpath", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    ) as { exports: Record<string, { default: string }> };
    expect(manifest.exports["./scrub"]?.default).toBe("./dist/scrub-entry.js");
  });
});
