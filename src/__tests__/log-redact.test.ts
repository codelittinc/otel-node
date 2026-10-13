import { describe, expect, it } from "vitest";
import { createTestLogger } from "../testing.js";
import { isSensitiveKey } from "../log-redact.js";

const VALUE = "SENTINEL-VALUE-42";

// Redaction is by key name, so the key table is the policy: these keys hold PII or credentials.
const REDACTED_KEYS = [
  ...[
    "ssnEnc",
    "dobEnc",
    "coApplicantSsnEnc",
    "coApplicantDobEnc",
    "ssn",
    "social_security_number",
  ],
  ...["accountNumberEnc", "routingNumberEnc", "routing_number", "accountNumber", "bankAccount"],
  ...[
    "taxIdEnc",
    "taxId",
    "tax_id",
    "taxpayerId",
    "ein",
    "employerEin",
    "employerEIN",
    "ein_number",
  ],
  ...["signingSecretEnc", "claimToken", "postgridRegistrationToken", "apiKey", "x-api-key"],
  ...["applicantEmail", "contactEmail", "callerEmail", "submittedByVendorEmail", "email"],
  ...["contactPhone", "callerPhone", "accountHolderName", "date_of_birth", "dateOfBirth"],
  ...["destinationAccountNumberEncSnapshot", "sourceAccountNumberEncSnapshot", "birthday"],
  ...["set-cookie", "authorization", "x-clerk-auth", "stripe-signature", "svix-signature"],
  ...["protectedPayloadEnc", "iban", "passport", "driversLicense", "abaNumber"],
  // person names
  ...["firstName", "lastName", "middleName", "fullName", "legalName", "preferredName"],
  ...["first_name", "last_name", "middle_name", "full_name", "legal_name", "preferred_name"],
  ...["contactName", "callerName", "occupantName", "payeeName", "billToName", "surname"],
  // addresses
  ...["streetAddress", "mailingAddress", "homeAddress", "street_address", "mailing_address"],
  ...["address", "address1", "addressLine1", "address_line_1", "postalCode", "postal_code"],
  ...["zip", "zipCode", "zip_code"],
  ...["forwardingAddress", "forwarding_address", "propertyAddress", "ipAddress", "street"],
  ...["street1", "street2", "line1", "line2", "Line1", "mobile", "mobilePhone"],
  ...["nameOnAccount", "name_on_account"],
];

// These must stay readable: record ids, and names that are not a person's.
const KEPT_KEYS = [
  ...["tenantId", "leaseId", "applicationId", "emailId", "bankAccountId", "resendEmailId"],
  ...["phoneIds", "token_id", "accountNumberId", "trace_id", "span_id"],
  ...["name", "queueName", "jobName", "categoryName", "targetName", "propertyName", "fileName"],
  ...["migrationName", "fromName", "vendorName", "businessName", "className", "bankName"],
  ...["amount", "status", "route", "unitNumber", "totalAmount", "balance", "currency"],
  ...["description", "protein", "reference", "audience", "ipAddressCount", "addressee"],
  ...["forwardingAddressId", "streetId", "line1Id", "lineItems", "line3", "streetsCount"],
  ...["addressCount", "lineNumber", "mobileId", "accountName", "nameOnAccountId"],
];

describe("key-pattern redaction", () => {
  it.each(REDACTED_KEYS)("redacts %s at depth 1 and depth 4", (key) => {
    expect(isSensitiveKey(key)).toBe(true);
    const { logger, records } = createTestLogger();
    logger.info({ [key]: VALUE, a: { b: { c: { [key]: VALUE } } } }, "m");
    expect(JSON.stringify(records[0])).not.toContain(VALUE);
  });

  it.each(KEPT_KEYS)("keeps %s", (key) => {
    expect(isSensitiveKey(key)).toBe(false);
    const { logger, records } = createTestLogger();
    logger.info({ nested: { [key]: VALUE } }, "m");
    expect(records[0]).toMatchObject({ nested: { [key]: VALUE } });
  });

  it("redacts inside arrays of objects", () => {
    const { logger, records } = createTestLogger();
    logger.info({ rows: [{ ssn: VALUE }, { nested: [{ contactEmail: VALUE }] }] }, "m");
    expect(JSON.stringify(records[0])).not.toContain(VALUE);
  });

  it("handles cycles and leaves the caller's object untouched", () => {
    const { logger, records } = createTestLogger();
    const input: Record<string, unknown> = { ssn: VALUE, tenantId: "t-1" };
    input.self = input;
    logger.info(input, "m");
    expect(JSON.stringify(records[0])).not.toContain(VALUE);
    expect(input.ssn).toBe(VALUE);
    expect(input.self).toBe(input);
  });

  it("fails closed when a getter throws", () => {
    const { logger, records } = createTestLogger();
    const bad = {
      get boom(): string {
        throw new Error("no");
      },
    };
    expect(() => logger.info({ bad }, "m")).not.toThrow();
    expect(records[0]).toMatchObject({ log_redaction_failed: true });
  });
});

describe("walker bounds", () => {
  it("bounds breadth", () => {
    const { logger, records } = createTestLogger();
    const wide = Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`k${i}`, i]));
    logger.info({ items: Array.from({ length: 5000 }, (_, i) => i), wide }, "m");
    const line = JSON.stringify(records[0]);
    expect(line.length).toBeLessThan(20_000);
    expect(line).toContain("[truncated]");
  });

  // Depth and breadth caps alone still allow 1,000^8 nodes; the per-line budget stops that.
  it("caps the total number of values walked per line", () => {
    const { logger, records } = createTestLogger();
    const row = Object.fromEntries(Array.from({ length: 900 }, (_, i) => [`c${i}`, { v: i }]));
    logger.info({ rows: Array.from({ length: 900 }, () => row) }, "m");
    const line = JSON.stringify(records[0]);
    expect(line).toContain("[truncated]");
    expect(line.length).toBeLessThan(200_000);
  });

  // Strings count toward the budget too: wide arrays of short strings must not scrub a million.
  it("counts every value, strings included, and checks the budget per array item", () => {
    const { logger, records } = createTestLogger();
    const rows = Array.from({ length: 1000 }, () => Array.from({ length: 1000 }, () => "s"));
    const started = performance.now();
    logger.info({ rows }, "m");
    const elapsed = performance.now() - started;
    expect(JSON.stringify(records[0])).toContain("[truncated]");
    expect(elapsed).toBeLessThan(200);
  });
});

describe("object keys", () => {
  // A key is logged like a value: an email or SSN used as a map key must not leak.
  it("redacts a key with an email or SSN shape and keeps colliding keys apart", () => {
    const { logger, records } = createTestLogger();
    logger.info({ counts: { ["jane@example.com"]: 2, ["123-45-6789"]: 3, ok: 1 } }, "m");
    expect(JSON.stringify(records[0])).not.toMatch(/jane@example\.com|123-45-6789/);
    const counts = records[0]!.counts as Record<string, unknown>;
    expect(Object.values(counts).sort()).toEqual([1, 2, 3]);
    expect(counts).toMatchObject({ "[redacted]": 2, ok: 1 });
  });

  // A caller key that looks like a marker must not overwrite, or be overwritten by, a real value.
  it("keeps every value when a literal marker key is also present", () => {
    const { logger, records } = createTestLogger();
    const counts = { "jane@example.com": 2, "bob@example.com": 3, "[redacted]": 9 };
    logger.info({ counts, more: { "[redacted]#1": 7, "a@b.co": 8, "[truncated]": 6 } }, "m");
    const out = records[0]!.counts as Record<string, unknown>;
    expect(Object.values(out).sort()).toEqual([2, 3, 9]);
    expect(out["[redacted]"]).toBe(9);
    expect(Object.values(records[0]!.more as object).sort()).toEqual([6, 7, 8]);
  });

  it("keeps a literal [truncated] key apart from the breadth marker", () => {
    const { logger, records } = createTestLogger();
    const wide: Record<string, unknown> = { "[truncated]": "real" };
    for (let i = 0; i < 1500; i++) wide[`k${i}`] = i;
    logger.info({ wide }, "m");
    const out = records[0]!.wide as Record<string, unknown>;
    expect(out["[truncated]"]).toBe("real");
    expect(Object.values(out)).toContain(true);
  });
});

describe("value conversion", () => {
  it("strips the query and userinfo of a URL value", () => {
    const { logger, records } = createTestLogger();
    logger.info({ target: new URL("https://jane:pw@api.example.com/v1/x?token=SENTINEL-Q") }, "m");
    expect(records[0]).toMatchObject({ target: "https://api.example.com/v1/x" });
  });

  it("scrubs email shapes from a URL value", () => {
    const { logger, records } = createTestLogger();
    logger.info(
      {
        page: new URL("https://x.io/residents/jane@example.com/statements"),
        mail: new URL("mailto:jane@example.com"),
      },
      "m",
    );
    expect(records[0]).toMatchObject({
      page: "https://x.io/residents/[redacted]/statements",
      mail: "mailto:[redacted]",
    });
  });

  it("logs a Buffer as its length", () => {
    const { logger, records } = createTestLogger();
    logger.info({ body: Buffer.from("first_name=Jane") }, "m");
    expect(records[0]).toMatchObject({ body: { bytes: 15 } });
  });

  it("walks the result of toJSON and keeps Date and Decimal-like values", () => {
    const when = new Date("2026-01-01T00:00:00Z");
    const money = { toJSON: () => "12.3400" };
    const payload = { toJSON: () => ({ contactEmail: VALUE, status: "ok" }) };
    const { logger, records } = createTestLogger();
    logger.info({ when, money, payload }, "m");
    expect(JSON.stringify(records[0])).not.toContain(VALUE);
    expect(records[0]).toMatchObject({
      when: when.toISOString(),
      money: "12.3400",
      payload: { status: "ok" },
    });
  });

  it("walks class instances", () => {
    class Applicant {
      ssn = VALUE;
      name = "n";
    }
    const { logger, records } = createTestLogger();
    logger.info({ a: new Applicant() }, "m");
    expect(JSON.stringify(records[0])).not.toContain(VALUE);
    expect(records[0]).toMatchObject({ a: { name: "n" } });
  });

  // WHY: a Prisma Decimal logs as the string its toJSON returns; depth must not cost it its value.
  it("keeps a primitive toJSON result at depth 9", () => {
    const decimal = { toJSON: () => "12.5000" };
    let nested: Record<string, unknown> = { amount: decimal };
    for (let i = 0; i < 7; i++) nested = { d: nested };
    const { logger, records } = createTestLogger();
    logger.info({ d: nested }, "m");
    expect(JSON.stringify(records[0])).toContain('"amount":"12.5000"');
  });
});
