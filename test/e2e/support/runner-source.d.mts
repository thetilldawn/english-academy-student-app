export function assertMaintenanceRunnerSource(input: {
  environment: Record<string, string | undefined>;
  changed: string[];
  dirty: string[];
}): void;
