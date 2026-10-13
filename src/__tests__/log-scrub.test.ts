import { describe, expect, it } from "vitest";
import { scrubErrorText, scrubMessage, scrubStack } from "../log-scrub.js";

describe("scrubMessage", () => {
  it("replaces SSN and email shapes", () => {
    expect(scrubMessage("jane@example.com 123-45-6789")).toBe("[redacted] [redacted]");
  });

  // WHY: a failed fetch quotes its URL, and the query is what staff searched for.
  it("strips the query and fragment from a URL inside a message", () => {
    expect(scrubMessage("fetch https://api.test/v1/tenants?search=Jane%20Doe#x failed")).toBe(
      "fetch https://api.test/v1/tenants failed",
    );
  });

  it("strips the query from an absolute path inside a message", () => {
    expect(scrubMessage("GET /v1/tenants?search=Jane%20Doe returned 500")).toBe(
      "GET /v1/tenants returned 500",
    );
  });

  // WHY: a connection error quotes its DSN, credentials included.
  it("strips the userinfo from a URL inside a message, whatever the scheme's case", () => {
    expect(scrubMessage("connect postgres://app:s3cret@db:5432/x failed")).toBe(
      "connect postgres://db:5432/x failed",
    );
    expect(scrubMessage("GET HTTPS://user:pass@host/p?q=1 failed")).toBe(
      "GET HTTPS://host/p failed",
    );
    expect(scrubMessage("fetch https://host/p failed")).toBe("fetch https://host/p failed");
  });

  it("leaves an email or a scheme-less user@host to the other rules", () => {
    expect(scrubMessage("sent to a@b.com")).toBe("sent to [redacted]");
    expect(scrubMessage("ssh deploy@buildbox failed")).toBe("ssh deploy@buildbox failed");
  });

  it("strips URL userinfo from error text and a stack's header", () => {
    expect(scrubErrorText("redis://:pw@cache:6379 refused")).toBe("redis://cache:6379 refused");
    expect(scrubStack("Error: amqp://u:p@mq/v\n    at f (x.js:1:1)")).toBe(
      "Error: amqp://mq/v\n    at f (x.js:1:1)",
    );
  });

  it("leaves a question mark that is not part of a URL", () => {
    expect(scrubMessage("why? because")).toBe("why? because");
  });
});
