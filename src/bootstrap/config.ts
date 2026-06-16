import { join, resolve } from "node:path";

export const PDF_PATH_ENV_KEY = "MAPPING_PDF_PATH";
export const DEEPSEEK_API_KEY_ENV_KEY = "DEEPSEEK_API_KEY";
export const DEEPSEEK_BASE_URL_ENV_KEY = "DEEPSEEK_BASE_URL";
export const DEEPSEEK_MODEL_NAME = "deepseek-v4-flash";
export const GATEWAY_HOST_ENV_KEY = "MAPPING_GATEWAY_HOST";
export const GATEWAY_PORT_ENV_KEY = "MAPPING_GATEWAY_PORT";
export const GATEWAY_BASE_URL_ENV_KEY = "MAPPING_GATEWAY_BASE_URL";

export function resolvePdfPath(optionsPdfPath?: string): string {
  const configured = optionsPdfPath ?? process.env[PDF_PATH_ENV_KEY] ?? join(process.cwd(), "Clean_Code.pdf");
  return resolve(configured);
}

export function resolveGatewayHost(defaultHost = "127.0.0.1"): string {
  return process.env[GATEWAY_HOST_ENV_KEY]?.trim() || defaultHost;
}

export function resolveGatewayPort(defaultPort = 8765): number {
  const configured = process.env[GATEWAY_PORT_ENV_KEY]?.trim();
  if (!configured) {
    return defaultPort;
  }

  const parsed = Number.parseInt(configured, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${GATEWAY_PORT_ENV_KEY}: ${configured}`);
  }

  return parsed;
}

export function resolveGatewayBaseUrl(options?: { host?: string; port?: number }): string {
  const configured = process.env[GATEWAY_BASE_URL_ENV_KEY]?.trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  const host = options?.host ?? resolveGatewayHost();
  const port = options?.port ?? resolveGatewayPort();
  return `http://${host}:${port}`;
}

export interface DeepSeekConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export function resolveDeepSeekConfig(): DeepSeekConfig {
  const apiKey = process.env[DEEPSEEK_API_KEY_ENV_KEY]?.trim();
  const baseUrl = process.env[DEEPSEEK_BASE_URL_ENV_KEY]?.trim();

  if (!apiKey) {
    throw new Error(`Missing required environment variable: ${DEEPSEEK_API_KEY_ENV_KEY}`);
  }

  if (!baseUrl) {
    throw new Error(`Missing required environment variable: ${DEEPSEEK_BASE_URL_ENV_KEY}`);
  }

  return {
    apiKey,
    baseUrl,
    model: DEEPSEEK_MODEL_NAME
  };
}
