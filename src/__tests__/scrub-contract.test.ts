import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LOG_REDACT_PATTERNS } from "../log-redact.js";
import { LOG_SCRUB_PATTERNS } from "../log-scrub.js";
import { REDACT_KEY_SETS, REDACT_LITERALS, REDACT_PATTERNS } from "../redact.js";
import { EXPORTER_LITERALS } from "../redacting-exporter.js";
import { TOKEN_PATH_CONTRACT, URL_PATH_LITERALS, URL_PATH_PATTERNS } from "../url-path.js";

const CONTRACT_FILE = fileURLToPath(new URL("../scrub-contract.json", import.meta.url));

const UPDATE_HINT =
  "This repo (codelittinc/otel-node) is the contract's source: update src/scrub-contract.json " +
  "here, then open a PR in codelittinc/carbon-observability, the follower, updating its copy at " +
  "agent/contracts/otel-node-scrub-contract.json and agent/config/scrub.alloy and " +
  "agent/config/scrub-logs-metrics.alloy to match.";

/** Every layer-1 pattern and key set the agent's layer-2 scrub repeats. */
const LAYER_1: Record<string, unknown> = {
  ...LOG_REDACT_PATTERNS,
  ...LOG_SCRUB_PATTERNS,
  ...REDACT_PATTERNS,
  ...URL_PATH_PATTERNS,
  TOKEN_PATH_TEMPLATES: TOKEN_PATH_CONTRACT,
  ...REDACT_KEY_SETS,
  ...REDACT_LITERALS,
  ...URL_PATH_LITERALS,
  ...EXPORTER_LITERALS,
};

function readContract(): Record<string, unknown> {
  return JSON.parse(readFileSync(CONTRACT_FILE, "utf8")) as Record<string, unknown>;
}

describe("scrub contract", () => {
  const contract = readContract();

  it("pins exactly the layer-1 patterns and key sets", () => {
    expect(Object.keys(contract).sort(), UPDATE_HINT).toEqual(Object.keys(LAYER_1).sort());
  });

  it.each(Object.entries(LAYER_1))("pins %s", (name, value) => {
    expect(contract[name], UPDATE_HINT).toEqual(value);
  });
});
