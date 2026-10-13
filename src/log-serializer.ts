import { serializeErrorBase } from "./log-errors.js";
import { scrubErrorText } from "./log-scrub.js";

/** The `err` serializer: an allowlisted, scrubbed copy of the error chain. Never throws. */
export function serializeError(value: unknown): unknown {
  try {
    return serializeErrorBase(value);
  } catch {
    let type = "Error";
    try {
      const name = (value as { name?: unknown } | null)?.name;
      if (typeof name === "string") type = scrubErrorText(name);
    } catch {
      // keep the default type
    }
    return { type, message: "[unserializable error]" };
  }
}
