import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** Type errors in `source`, compiled as an app's file with `bullmq` absent and lib checks on. */
function typeErrors(source: string): string[] {
  const file = `${ROOT}consumer-check.ts`;
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    skipLibCheck: false,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    target: ts.ScriptTarget.ES2022,
    types: ["node"],
  };
  const host = ts.createCompilerHost(options);
  const hidden = (path: string) => /[\\/]node_modules[\\/](\.pnpm[\\/]bullmq@|bullmq[\\/])/.test(path);
  const { fileExists, readFile, getSourceFile } = host;
  host.fileExists = (path) => path === file || (!hidden(path) && fileExists.call(host, path));
  host.readFile = (path) => (path === file ? source : hidden(path) ? undefined : readFile.call(host, path));
  host.getSourceFile = (path, ...rest) =>
    path === file
      ? ts.createSourceFile(path, source, ts.ScriptTarget.ES2022, true)
      : getSourceFile.call(host, path, ...rest);
  const program = ts.createProgram([file], options, host);
  return ts
    .getPreEmitDiagnostics(program)
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
}

// WHY: bullmq is an optional peer. An app without it must typecheck the main entry even with
// skipLibCheck off; only the `./bullmq` entry may name its types.
// Each case builds a full compiler program, which a cold CI runner takes well over 5 s to do.
const CI_TIMEOUT = 60_000;

describe("the built types without bullmq installed", () => {
  it("typecheck the main entry", () => {
    const errors = typeErrors(
      'import * as otel from "./dist/index.js";\nexport const start = otel.startTelemetry;\n',
    );
    expect(errors).toEqual([]);
  }, CI_TIMEOUT);

  it("fail the ./bullmq entry, so bullmq is really hidden", () => {
    const errors = typeErrors('export * from "./dist/bullmq.js";\n');
    expect(errors.join("\n")).toMatch(/bullmq/);
  }, CI_TIMEOUT);
});
