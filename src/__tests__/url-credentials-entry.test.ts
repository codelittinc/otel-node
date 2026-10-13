import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SRC = new URL("../", import.meta.url);
const IMPORT = /\b(?:import|export)\s[^'"]*?from\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']/g;
const NODE_GLOBALS = /\b(?:process|Buffer|require|__dirname|__filename|global)\b/;

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
      const specifier = (match[1] ?? match[2])!;
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
    expect([...graph.keys()].filter((key) => key.startsWith("external:"))).toEqual([]);
  });

  it("uses no Node global in any file it reaches", () => {
    for (const [file, source] of graph) {
      const code = source.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      expect(NODE_GLOBALS.test(code), file).toBe(false);
    }
  });

  it("is exported as its own subpath", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    ) as { exports: Record<string, { default: string }> };
    expect(manifest.exports["./url-credentials"]?.default).toBe("./dist/url-credentials.js");
  });
});
