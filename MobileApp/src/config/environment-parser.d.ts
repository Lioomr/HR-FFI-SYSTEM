export interface Environment {
  readonly apiBaseUrl: string;
}

interface EnvironmentOptions {
  readonly isDevelopment?: boolean;
}

export function parseEnvironment(
  rawApiBaseUrl: string | undefined,
  options?: EnvironmentOptions,
): Environment;
