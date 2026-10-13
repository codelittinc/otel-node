import { describe, expect, it } from "vitest";
import { createTestLogger } from "../testing.js";

// The payment paths log record ids so a failure can be traced to its row, and they log provider
// errors whose payloads hold bank and card data. The ids must survive; the payloads must not.
describe("money-path log lines", () => {
  it("keeps record ids and drops account numbers, PostGrid detail and Stripe raw", () => {
    const { logger, records } = createTestLogger();
    const postgrid = Object.assign(new Error("Invalid bank account 000123456789"), {
      name: "PostgridError",
      status: 400,
      body: { error: { message: "account 000123456789 routing 021000021 for Jane Resident" } },
    });
    const stripe = Object.assign(new Error("Your bank account was declined."), {
      name: "StripeInvalidRequestError",
      type: "StripeInvalidRequestError",
      code: "bank_account_declined",
      raw: { bank_account: { account_holder_name: "Jane Resident", last4: "6789" } },
    });
    logger.error(
      {
        event: "postgrid_registration_failed",
        bankAccountId: "ba-1",
        emailId: "em-1",
        resendEmailId: "re-1",
        paymentId: "pay-1",
        accountNumber: "000123456789",
        routingNumber: "021000021",
        bankAccount: { accountNumber: "000123456789" },
        err: postgrid,
        cause: stripe,
      },
      "registration failed",
    );
    const line = JSON.stringify(records[0]);
    expect(line).not.toMatch(/000123456789|021000021|Jane Resident|6789/);
    expect(records[0]).toMatchObject({
      bankAccountId: "ba-1",
      emailId: "em-1",
      resendEmailId: "re-1",
      paymentId: "pay-1",
      err: { type: "Error", name: "PostgridError", status: 400 },
      cause: { name: "StripeInvalidRequestError", code: "bank_account_declined" },
    });
  });
});
