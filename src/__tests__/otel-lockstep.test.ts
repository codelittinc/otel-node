import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type Manifest = Partial<Record<"dependencies" | "devDependencies", Record<string, string>>>;

const manifest = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as Manifest;
const pins = Object.fromEntries(
  Object.entries({ ...manifest.dependencies, ...manifest.devDependencies }).filter(([name]) =>
    name.startsWith("@opentelemetry/"),
  ),
);

/** Released together from opentelemetry-js: the experimental (0.x) line. */
const EXPERIMENTAL = [
  "@opentelemetry/api-logs",
  "@opentelemetry/exporter-logs-otlp-proto",
  "@opentelemetry/exporter-metrics-otlp-proto",
  "@opentelemetry/exporter-trace-otlp-proto",
  "@opentelemetry/instrumentation",
  "@opentelemetry/instrumentation-http",
  "@opentelemetry/sdk-logs",
  "@opentelemetry/sdk-node",
];
/** Released together from opentelemetry-js: the stable SDK line. */
const STABLE = [
  "@opentelemetry/context-async-hooks",
  "@opentelemetry/core",
  "@opentelemetry/resources",
  "@opentelemetry/sdk-metrics",
  "@opentelemetry/sdk-trace-base",
];

// WHY: OTel packages share global state through @opentelemetry/api. Two versions of one package
// in an app's tree register two providers, and spans or metrics from one silently never export.
describe("OpenTelemetry pins", () => {
  it("are exact", () => {
    for (const [name, version] of Object.entries(pins)) {
      expect(version, name).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it.each([
    ["experimental", EXPERIMENTAL],
    ["stable", STABLE],
  ])("share one version across the %s family", (_family, names) => {
    for (const name of names) expect(pins[name], name).toBeDefined();
    expect(new Set(names.map((name) => pins[name])).size).toBe(1);
  });
});
