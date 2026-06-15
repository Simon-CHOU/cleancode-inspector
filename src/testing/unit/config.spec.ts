import { afterEach, describe, expect, it } from "vitest";

import { PDF_PATH_ENV_KEY, resolvePdfPath } from "../../bootstrap/config.js";

const previousPdfPath = process.env[PDF_PATH_ENV_KEY];

afterEach(() => {
  if (previousPdfPath === undefined) {
    delete process.env[PDF_PATH_ENV_KEY];
    return;
  }
  process.env[PDF_PATH_ENV_KEY] = previousPdfPath;
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
});
