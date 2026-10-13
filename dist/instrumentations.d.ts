import type { Instrumentation } from "@opentelemetry/instrumentation";
/**
 * Hand-picked list: the auto-instrumentations bundle adds fs, dns and net spans that are noise.
 * The app's own instrumentations (Prisma, at the app's version) come last.
 */
export declare function buildInstrumentations(ignoredPaths: readonly string[], appInstrumentations?: readonly Instrumentation[]): Instrumentation[];
