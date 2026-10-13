import { serializeErrorBase } from "./log-errors.js";
import { scrubErrorText } from "./log-scrub.js";
/** Serializes one error value to the scrubbed shape `log` exports under `err`: message and stack scrubbed, only allowlisted fields kept, never throws. */
export function serializeError(value) {
    try {
        return serializeErrorBase(value);
    }
    catch {
        let type = "Error";
        try {
            const name = value?.name;
            if (typeof name === "string")
                type = scrubErrorText(name);
        }
        catch {
            // keep the default type
        }
        return { type, message: "[unserializable error]" };
    }
}
