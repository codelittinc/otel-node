import { type ViewOptions } from "@opentelemetry/sdk-metrics";
import type { MetricViewOptions } from "./options.js";
/**
 * One view that drops every attribute outside `allowedAttributes` from the app's own instruments
 * (`<instrumentPrefix>*`), so an id or a message never becomes a label. No options, no views.
 */
export declare function metricViews(options?: MetricViewOptions): ViewOptions[];
