import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { createApplication } from "../../bootstrap/createApplication.js";
import { FakeLlmClient } from "../fixtures/fakeLlmClient.js";

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "mapping-app-life-"));
  tempDirs.push(dir);
  return dir;
}

class FakeClosablePdfReaderClient {
  closed = false;

  async searchPdf() {
    return { results: [] };
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

afterEach(() => {
  while (tempDirs.length) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("application lifecycle", () => {
  it("closes external clients on dispose", async () => {
    const pdfClient = new FakeClosablePdfReaderClient();
    const llmClient = new FakeLlmClient(JSON.stringify({ findings: [], cross_refs: [] }));
    const app = createApplication({
      baseDir: createTempDir(),
      pdfReaderClient: pdfClient,
      llmClient
    });

    await app.dispose();

    expect(pdfClient.closed).toBe(true);
    expect(llmClient.closed).toBe(true);
  });
});
