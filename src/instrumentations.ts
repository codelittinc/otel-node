import type { Instrumentation } from "@opentelemetry/instrumentation";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici";
import { IORedisInstrumentation } from "@opentelemetry/instrumentation-ioredis";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { RuntimeNodeInstrumentation } from "@opentelemetry/instrumentation-runtime-node";

/** An ignored path covers itself and everything below it, never a sibling sharing a prefix. */
function isIgnored(url: string | undefined, ignoredPaths: readonly string[]): boolean {
  const path = (url ?? "").split("?")[0]!;
  return ignoredPaths.some((ignored) => path === ignored || path.startsWith(`${ignored}/`));
}

/**
 * Hand-picked list: the auto-instrumentations bundle adds fs, dns and net spans that are noise.
 * The app's own instrumentations (Prisma, at the app's version) come last.
 */
export function buildInstrumentations(
  ignoredPaths: readonly string[],
  appInstrumentations: readonly Instrumentation[] = [],
): Instrumentation[] {
  return [
    // Event-loop delay, heap, GC. Its uncaught-exception capture stays off: it would emit the raw,
    // unscrubbed exception message and stack as a log record.
    new RuntimeNodeInstrumentation({ captureUncaughtException: false }),
    new HttpInstrumentation({
      ignoreIncomingRequestHook: (request) => isIgnored(request.url, ignoredPaths),
    }),
    new UndiciInstrumentation(),
    new IORedisInstrumentation({ requireParentSpan: true }),
    // SQL text only, never bound values.
    new PgInstrumentation({ enhancedDatabaseReporting: false, requireParentSpan: true }),
    ...appInstrumentations,
  ];
}
