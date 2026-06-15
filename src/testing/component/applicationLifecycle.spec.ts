import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { createApplication } from "../../bootstrap/createApplication.js";

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
  it("closes external pdf-reader client on dispose", async () => {
    const client = new FakeClosablePdfReaderClient();
    const app = createApplication({
      baseDir: createTempDir(),
      pdfReaderClient: client
    });

    await app.dispose();

    expect(client.closed).toBe(true);
  });
});
