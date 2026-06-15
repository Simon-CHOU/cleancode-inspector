import { afterEach, describe, expect, it } from "vitest";

import {
  DEEPSEEK_API_KEY_ENV_KEY,
  DEEPSEEK_BASE_URL_ENV_KEY,
  DEEPSEEK_MODEL_NAME,
  PDF_PATH_ENV_KEY,
  resolveDeepSeekConfig,
  resolvePdfPath
} from "../../bootstrap/config.js";

const previousPdfPath = process.env[PDF_PATH_ENV_KEY];
const previousApiKey = process.env[DEEPSEEK_API_KEY_ENV_KEY];
const previousBaseUrl = process.env[DEEPSEEK_BASE_URL_ENV_KEY];

afterEach(() => {
  if (previousPdfPath === undefined) {
    delete process.env[PDF_PATH_ENV_KEY];
  } else {
    process.env[PDF_PATH_ENV_KEY] = previousPdfPath;
  }

  if (previousApiKey === undefined) {
    delete process.env[DEEPSEEK_API_KEY_ENV_KEY];
  } else {
    process.env[DEEPSEEK_API_KEY_ENV_KEY] = previousApiKey;
  }

  if (previousBaseUrl === undefined) {
    delete process.env[DEEPSEEK_BASE_URL_ENV_KEY];
  } else {
    process.env[DEEPSEEK_BASE_URL_ENV_KEY] = previousBaseUrl;
  }
});

describe("bootstrap config", () => {
  it("prioritizes explicit option over environment variable", () => {
    process.env[PDF_PATH_ENV_KEY] = "D:\\Downloads\\ignored.pdf";

    const resolved = resolvePdfPath("D:\\Downloads\\explicit.pdf");

    expect(resolved.replaceAll("/", "\\")).toContain("D:\\Downloads\\explicit.pdf");
  });

  it("reads project-level PDF path from environment variable", () => {
    process.env[PDF_PATH_ENV_KEY] = "D:\\Downloads\\Clean_Code.pdf.split\\Clean_Code.pdf";

    const resolved = resolvePdfPath();

    expect(resolved.replaceAll("/", "\\")).toContain(
      "D:\\Downloads\\Clean_Code.pdf.split\\Clean_Code.pdf"
    );
  });

  it("reads DeepSeek BYOK config from environment and keeps fixed model name", () => {
    process.env[DEEPSEEK_API_KEY_ENV_KEY] = "sk-test";
    process.env[DEEPSEEK_BASE_URL_ENV_KEY] = "https://api.deepseek.example/v1";

    const resolved = resolveDeepSeekConfig();

    expect(resolved.apiKey).toBe("sk-test");
    expect(resolved.baseUrl).toBe("https://api.deepseek.example/v1");
    expect(resolved.model).toBe(DEEPSEEK_MODEL_NAME);
  });
});
