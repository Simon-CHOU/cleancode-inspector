import { join, resolve } from "node:path";

export const PDF_PATH_ENV_KEY = "MAPPING_PDF_PATH";
export const DEEPSEEK_API_KEY_ENV_KEY = "DEEPSEEK_API_KEY";
export const DEEPSEEK_BASE_URL_ENV_KEY = "DEEPSEEK_BASE_URL";
export const DEEPSEEK_MODEL_NAME = "deepseek-v4-flash";

export function resolvePdfPath(optionsPdfPath?: string): string {
  const configured = optionsPdfPath ?? process.env[PDF_PATH_ENV_KEY] ?? join(process.cwd(), "Clean_Code.pdf");
  return resolve(configured);
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
