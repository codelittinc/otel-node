export type TelemetryEnv = Partial<Record<string, string>>;
export interface TelemetryConfig {
    enabled: boolean;
    serviceName: string;
    serviceVersion: string;
    environment: string;
    serviceInstanceId: string;
}
/** Telemetry exports only when an OTLP endpoint is set; local runs, CI and tests stay silent. */
export declare function resolveTelemetryConfig(fallbackServiceName: string, env?: TelemetryEnv): TelemetryConfig;
