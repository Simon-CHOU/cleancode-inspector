import { mkdtempSync } from "node:fs";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { createApplication } from "../../bootstrap/createApplication.js";
import { DomainError } from "../../domain/errors.js";
import { ABSTRACT_TASK_ENGINE_FIXTURE } from "../fixtures/abstractTaskEngineFixture.js";
import { createAbstractTaskEngineLlmResponse, FakeLlmClient } from "../fixtures/fakeLlmClient.js";

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "mapping-mcp-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("application use cases", () => {
  it("creates queued jobs for valid java input", async () => {
    const app = createApplication({
      baseDir: createTempDir(),
      llmClient: new FakeLlmClient(createAbstractTaskEngineLlmResponse())
    });

    const created = await app.createMappingJob.execute({
      file_name: "AbstractTaskEngine.java",
      language: "java",
      source_code: ABSTRACT_TASK_ENGINE_FIXTURE
    });

    expect(created.status).toBe("queued");
    expect(created.job_id).toMatch(/^job_/);
    expect(created.submission_id).toMatch(/^sub_/);
  });

  it("reports result-not-ready before pipeline completion", async () => {
    const app = createApplication({
      baseDir: createTempDir(),
      llmClient: new FakeLlmClient(createAbstractTaskEngineLlmResponse())
    });
    const created = await app.createMappingJob.execute({
      file_name: "AbstractTaskEngine.java",
      language: "java",
      source_code: ABSTRACT_TASK_ENGINE_FIXTURE
    });

    await expect(
      app.getMappingResult.execute({ jobId: created.job_id })
    ).rejects.toMatchObject({
      code: "RESULT_NOT_READY"
    } satisfies Partial<DomainError>);
  });
});
