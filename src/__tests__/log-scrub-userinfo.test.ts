import { describe, expect, it } from "vitest";
import { scrubMessage } from "../log-scrub.js";
import { scrubAttributes, scrubSpanName, stripQuery } from "../redact.js";
import {
  MESSAGE_USERINFO_CASES,
  SPAN_NAME_CASES,
  URL_ATTRIBUTE_CASES,
  URL_USERINFO_CASES,
} from "./userinfo-cases.js";

// WHY: a DSN password often holds an unencoded `@`, `?`, `#` or `/`; a scrub that stops early
// exports the rest of it.
describe("URL userinfo", () => {
  it.each(MESSAGE_USERINFO_CASES)("scrubMessage(%j) is %j", (input, expected) => {
    expect(scrubMessage(input)).toBe(expected);
  });

  it.each(URL_USERINFO_CASES)("stripQuery(%j) is %j", (input, expected) => {
    expect(stripQuery(input)).toBe(expected);
  });

  it.each(SPAN_NAME_CASES)("scrubSpanName(%j) is %j", (input, expected) => {
    expect(scrubSpanName(input, undefined)).toBe(expected);
  });

  it.each(URL_ATTRIBUTE_CASES)("scrubAttributes %s %j is %j", (key, value, expected) => {
    expect(scrubAttributes({ [key]: value })[key]).toBe(expected);
  });
});
