import { afterEach, describe, expect, it } from "vitest";

import {
  DEEPSEEK_API_KEY_ENV_KEY,
  DEEPSEEK_BASE_URL_ENV_KEY,
  DEEPSEEK_MODEL_NAME,
  GATEWAY_BASE_URL_ENV_KEY,
  GATEWAY_HOST_ENV_KEY,
  GATEWAY_PORT_ENV_KEY,
  PDF_PATH_ENV_KEY,
  resolveDeepSeekConfig,
  resolveGatewayBaseUrl,
  resolveGatewayHost,
  resolveGatewayPort,
  resolvePdfPath
} from "../../bootstrap/config.js";

const previousPdfPath = process.env[PDF_PATH_ENV_KEY];
const previousApiKey = process.env[DEEPSEEK_API_KEY_ENV_KEY];
const previousBaseUrl = process.env[DEEPSEEK_BASE_URL_ENV_KEY];
const previousGatewayHost = process.env[GATEWAY_HOST_ENV_KEY];
const previousGatewayPort = process.env[GATEWAY_PORT_ENV_KEY];
const previousGatewayBaseUrl = process.env[GATEWAY_BASE_URL_ENV_KEY];

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

  if (previousGatewayHost === undefined) {
    delete process.env[GATEWAY_HOST_ENV_KEY];
  } else {
    process.env[GATEWAY_HOST_ENV_KEY] = previousGatewayHost;
  }

  if (previousGatewayPort === undefined) {
    delete process.env[GATEWAY_PORT_ENV_KEY];
  } else {
    process.env[GATEWAY_PORT_ENV_KEY] = previousGatewayPort;
  }

  if (previousGatewayBaseUrl === undefined) {
    delete process.env[GATEWAY_BASE_URL_ENV_KEY];
  } else {
    process.env[GATEWAY_BASE_URL_ENV_KEY] = previousGatewayBaseUrl;
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

  it("derives gateway host, port, and base url from environment", () => {
    process.env[GATEWAY_HOST_ENV_KEY] = "127.0.0.1";
    process.env[GATEWAY_PORT_ENV_KEY] = "9999";

    expect(resolveGatewayHost()).toBe("127.0.0.1");
    expect(resolveGatewayPort()).toBe(9999);
    expect(resolveGatewayBaseUrl()).toBe("http://127.0.0.1:9999");
  });

  it("prioritizes explicit gateway base url when configured", () => {
    process.env[GATEWAY_BASE_URL_ENV_KEY] = "http://localhost:8877/";

    expect(resolveGatewayBaseUrl({ host: "127.0.0.1", port: 8765 })).toBe("http://localhost:8877");
  });
});
