import { describe, expect, it } from "vitest";
import { boundedLabel } from "../bounded.js";

const PROVIDERS = ["stripe", "stripe_v2", "postgrid", "resend", "happyco", "funnel"] as const;

/** A metric label is a closed set: anything outside the allowlist collapses into one value. */
describe("boundedLabel", () => {
  it("passes an allowlisted value through", () => {
    expect(boundedLabel("stripe", PROVIDERS)).toBe("stripe");
    expect(boundedLabel("funnel", new Set(PROVIDERS))).toBe("funnel");
  });

  it.each([
    ["a path traversal", "/v1/webhooks/../../x"],
    ["an empty string", ""],
    ["a 10 000-character string", "s".repeat(10_000)],
    ["a near miss in case", "Stripe"],
    ["an id", "3f2c1a9e-5b7d-4c11-9a0e-2d6f8b1c4e77"],
  ])("maps %s to other", (_, value) => {
    expect(boundedLabel(value, PROVIDERS)).toBe("other");
  });

  it("maps a non-string to other", () => {
    expect(boundedLabel(undefined, PROVIDERS)).toBe("other");
    expect(boundedLabel(42, PROVIDERS)).toBe("other");
  });
});
