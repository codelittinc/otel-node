import { createAllowListAttributesProcessor } from "@opentelemetry/sdk-metrics";
/**
 * One view that drops every attribute outside `allowedAttributes` from the app's own instruments
 * (`<instrumentPrefix>*`), so an id or a message never becomes a label. No options, no views.
 */
export function metricViews(options) {
    if (!options)
        return [];
    return [
        {
            instrumentName: `${options.instrumentPrefix}*`,
            attributesProcessors: [createAllowListAttributesProcessor([...options.allowedAttributes])],
        },
    ];
}
