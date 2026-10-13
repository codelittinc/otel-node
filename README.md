# @codelittinc/otel-node

In-process OpenTelemetry for Node services: SDK boot (traces, metrics, OTLP logs, Pyroscope
profiles), layer 1 of the two-layer PII scrub, a pino logger whose scrubbed lines are exported
as OTLP logs, and trace-context helpers. Extracted from Backbone's `packages/telemetry`.

Telemetry exports only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set. Without it nothing is exported
and no SDK module is loaded, so local runs, CI and tests stay silent and cheap.

## Install by commit

Nothing is published. Install the repo as a git dependency pinned to a commit; the built
`dist/` is committed, so there is no build step and no token is needed:

```json
{
  "dependencies": {
    "@codelittinc/otel-node": "github:codelittinc/otel-node#<commit-sha>"
  }
}
```

Pin a full commit SHA, never a branch. To upgrade, move the SHA.

## Start telemetry

Start it before the app loads `http`, from a file run with `node --import`:

```ts
// src/instrumentation.ts, run as: node --import ./dist/instrumentation.js dist/index.js
import { PrismaInstrumentation } from "@prisma/instrumentation";
import { startTelemetry } from "@codelittinc/otel-node";

await startTelemetry({
  serviceName: "api",
  logScope: "acp",
  metricViews: { instrumentPrefix: "acp.", allowedAttributes: ["queue", "outcome", "route"] },
  instrumentations: [new PrismaInstrumentation()],
  redactKeys: ["unitLabel"],
  onError: (err, context) => reportToErrorTracker(err, context),
  ignoredPaths: ["/health"],
});
```

An app with no options to pass can use the register entry instead. It reads
`OTEL_SERVICE_NAME`, which is also its log scope:

```sh
OTEL_SERVICE_NAME=acp-worker node --import @codelittinc/otel-node/register dist/worker.js
```

`startTelemetry` never throws: a failed start, or options it cannot read, logs
`telemetry_start_failed` and the app runs on. Telemetry starts once per process: the first call's
options win whether or not it exports, and a later call with different options is ignored with a
`telemetry_restart_ignored` warning.
`shutdownTelemetry(timeoutMs = 5000)` flushes spans, metrics, log records and profiles, bounded
so a dead collector cannot stall a shutdown.

## Options

| Option             | Default            | What it does                                                                                                                                                  |
| ------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `serviceName`      | required           | `service.name`, unless `OTEL_SERVICE_NAME` is set.                                                                                                            |
| `logScope`         | `serviceName`      | The OTel logger scope of exported log records. Only records from this scope are exported. Also names the BullMQ tracer and the `<logScope>.request_id` span attribute. |
| `metricViews`      | none               | `{ instrumentPrefix, allowedAttributes }`: instruments named `<prefix>*` export only those attributes. Without it, every attribute is kept.                   |
| `instrumentations` | `[]`               | Appended to the package's list (http, undici, ioredis, pg, runtime-node). Pass Prisma here, at the app's own version.                                         |
| `redactKeys`       | `[]`               | Key names (whole name, any case) redacted on top of the default PII key list: log fields, and span attributes by whole name or last `.` segment. A fixed list of attributes the instrumentations emit (`db.system.name`, `http.route`, `bullmq.job.id`, ...) is matched by whole name only, so `name` never wipes them; any other attribute, under any namespace, fails closed. Prisma's bare `name`, `method` and `model` are matched by whole name, so an app key `name` also redacts Prisma's span name attribute. It can only add; no default is ever removed. The agent's layer-2 scrub does not repeat them. |
| `onError`          | none               | `(err, { service })`: receives each fatal error `installFatalHandlers` sees when it is given no `report`. Wire your error tracker here.                         |
| `ignoredPaths`     | `[]`               | Incoming paths that open no server span; each covers itself and everything below it.                                                                         |
| `esmLoaderHook`    | `true`             | `false` for a host that runs bundled CommonJS (Next.js).                                                                                                      |
| `logs`             | `true`             | `false` keeps log lines on stdout only.                                                                                                                       |
| `env`              | `process.env`      | Read instead of the process environment (tests).                                                                                                              |

Environment: `OTEL_EXPORTER_OTLP_ENDPOINT` (on/off), `OTEL_SDK_DISABLED=true` (kill switch),
`OTEL_SERVICE_NAME`, `OTEL_LOG_LEVEL` (SDK debug logging), `LOG_LEVEL`,
`PYROSCOPE_SERVER_ADDRESS` (profiling, independent of the endpoint), and on Railway
`RAILWAY_GIT_COMMIT_SHA`, `RAILWAY_DEPLOYMENT_ID`, `RAILWAY_ENVIRONMENT_NAME` and
`RAILWAY_REPLICA_ID` for the resource.

## Entries

| Import                                    | What                                                                                                                                                                                                                                       |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@codelittinc/otel-node`                  | `startTelemetry`, `shutdownTelemetry`, `isTelemetryStarted`, `setHttpRoute`, `getMeter`, `log`, `configureLogger`, `flushLog`, `captureConsole`, `installFatalHandlers`, `boundedLabel`, `currentTraceparent`, `withLinkedSpan`, `withRootSpan`, `serializeError` (the scrubbed error shape `log` exports under `err`), `traceLogFields` (the active span's `trace_id` and `span_id`, or `{}`), and the `TelemetryOptions`, `TelemetryConfig`, `TelemetryEnv`, `MetricViewOptions`, `ErrorHookContext`, `Meter` and `BatchObservableResult` types |
| `@codelittinc/otel-node/bullmq`           | `bullmqTelemetry()`: the adapter for a BullMQ Queue or Worker `telemetry` option                                                                                                                                                           |
| `@codelittinc/otel-node/register`         | `node --import` entry, no options                                                                                                                                                                                                          |
| `@codelittinc/otel-node/testing`          | `createTestLogger()`: the real logger, capturing parsed records in memory                                                                                                                                                                 |
| `@codelittinc/otel-node/url-credentials`  | URL userinfo and query scrub. Imports nothing from Node or OpenTelemetry, so a browser bundle can use it                                                                                                                                  |

`bullmq` (`^6.3.8`) is an optional peer dependency, used only by the `./bullmq` entry, so an app
without it typechecks the main entry even with `skipLibCheck` off. `bullmqTelemetry()` returns
the adapter once telemetry has started, and `undefined` before.

## Logging

`log` is the one pino logger a process shares. Each entry point calls
`configureLogger({ service })` once; modules log through a child that binds `component`
(`log.child({ component: "db" })`). Every line is scrubbed before it is written (below), then the
same scrubbed line is copied to OTLP logs.

An app that logs with `console` calls `captureConsole()` once at startup. Every `console.warn` and
`console.error` line still reaches the console unchanged, and a scrubbed copy is exported under
the log scope. Each argument is first reduced to what `log` would export for it (PII keys
redacted, no function, Map or Set contents), and the formatted line is scrubbed last, so the
exported copy never holds more than a `log` line would. `console.log` and `console.info` are left
alone. The console copy on stdout is not scrubbed: move a line that can carry personal data to
`log`. The SDK's own diagnostics (`OTEL_LOG_LEVEL`) bypass the capture and are never exported.

## The two-layer scrub

Personal data is removed twice before it is stored.

1. **Layer 1, in the process (this package).** The logger redacts PII and credential keys at any
   depth (`ssn`, `email`, `phone`, names, addresses, account and routing numbers, tokens, secrets,
   plus `redactKeys`), serializes errors deny-by-default, and scrubs SSN shapes, emails and URL
   userinfo and queries from every string. The span exporter drops request and response bodies
   and headers, bound SQL values and Redis statements, redacts exception messages, strips URL
   queries and userinfo, replaces a URL path with its route template, and redacts any attribute
   named by `redactKeys`.
2. **Layer 2, in the agent.** The Alloy agent in `codelittinc/carbon-observability` repeats the
   pattern scrub on every span, log and metric before it leaves the host. It repeats only this
   package's defaults (the contract below), never an app's `redactKeys`: for those, layer 1 is
   the only scrub.

`src/scrub-contract.json` pins every layer-1 pattern and key set the agent repeats. This repo is
its source; `codelittinc/carbon-observability` follows with a copy at
`agent/contracts/otel-node-scrub-contract.json`. Changing a scrub pattern fails
`scrub-contract.test.ts` until the contract is updated here, then the agent's copy and its
`scrub.alloy` and `scrub-logs-metrics.alloy` follow in a PR there.

## Rules for an app using this package

1. **No PII in span or event attributes, span names, or log fields.** Record identifiers go on
   spans and logs only, never on metrics.
2. **Metric labels come from fixed sets:** route template, method, status, queue, kind. Never a
   raw path, an id, or an error message. Set `metricViews` so an app instrument exports only the
   labels in `allowedAttributes`; a label missing there is dropped. `boundedLabel` collapses a
   value outside an allowlist to `"other"`.
3. **Money is never a metric value.** Count events instead.
4. **Every instrumentation is checked against the span scrub.** One added to this package needs a
   scrub test in `redacting-exporter.test.ts` before it merges. An app that passes its own
   through `instrumentations` (Prisma, for example) checks the attributes it emits: an attribute
   key that carries values the scrub does not already drop or redact needs a PR here, adding the
   key to the scrub with a test, before the app ships it. `redactKeys` covers a key in the
   meantime, in layer 1 only.
5. **Only the scrubbed log line is exported.** Records are exported only from the log scope, built
   from the shared logger's already scrubbed output; OTel's own diagnostics
   (`event: "otel_diag"`) stay on stdout. Never add a logger instrumentation or a log record
   processor that sees a record before the logger scrubs it.
6. **Only process entry points boot the SDK and call `installFatalHandlers`.** Libraries and
   shared packages import only the logger API (`log`, `configureLogger`, `flushLog`) and
   `currentTraceparent`. The `Meter` and `BatchObservableResult` types let callers type
   instruments without `@opentelemetry/api`.
7. **Keep `@opentelemetry/*` versions in lockstep with this package.** Two versions of one OTel
   package in an app's tree register two providers, and one of them silently never exports.

## Development

Node 22 and pnpm.

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build    # then commit dist/
```

CI runs the type check, the tests, and a fresh build that must match the committed `dist/`.
