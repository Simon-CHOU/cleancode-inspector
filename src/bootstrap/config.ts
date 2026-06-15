import { join, resolve } from "node:path";

export const PDF_PATH_ENV_KEY = "MAPPING_PDF_PATH";

export function resolvePdfPath(optionsPdfPath?: string): string {
  const configured = optionsPdfPath ?? process.env[PDF_PATH_ENV_KEY] ?? join(process.cwd(), "Clean_Code.pdf");
  return resolve(configured);
}
