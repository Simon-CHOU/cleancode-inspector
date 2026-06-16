import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { createApplication } from "../../bootstrap/createApplication.js";
import { createMappingHttpService } from "../../http/createMappingHttpService.js";
import { ABSTRACT_TASK_ENGINE_FIXTURE } from "../fixtures/abstractTaskEngineFixture.js";
import { createAbstractTaskEngineLlmResponse, FakeLlmClient } from "../fixtures/fakeLlmClient.js";

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "mapping-http-service-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("mapping HTTP service", () => {
  it("returns host hints when creating a job", async () => {
    const app = createApplication({
      baseDir: createTempDir(),
      llmClient: new FakeLlmClient(createAbstractTaskEngineLlmResponse())
    });
    const service = createMappingHttpService(app, "http://127.0.0.1:8765");

    const created = await service.mappingCreateJob({
      file_name: "AbstractTaskEngine.java",
      language: "java",
      source_code: ABSTRACT_TASK_ENGINE_FIXTURE
    });

    expect(created.job.status).toBe("queued");
    expect(created.viewer_url).toContain("jobId=");
    expect(created.next_action).toBe("poll_job");
    expect(created.links.some((item) => item.rel === "result")).toBe(true);
  });

  it("normalizes validation errors to HTTP 400", async () => {
    const app = createApplication({
      baseDir: createTempDir(),
      llmClient: new FakeLlmClient(createAbstractTaskEngineLlmResponse())
    });
    const service = createMappingHttpService(app, "http://127.0.0.1:8765");

    const formatted = service.formatHttpError(await service.mappingCreateJob({ language: "java" }).catch((error) => error));

    expect(formatted.code).toBe("INVALID_REQUEST");
    expect(formatted.statusCode).toBe(400);
  });

  it("maps missing job to 404", async () => {
    const app = createApplication({
      baseDir: createTempDir(),
      llmClient: new FakeLlmClient(createAbstractTaskEngineLlmResponse())
    });
    const service = createMappingHttpService(app, "http://127.0.0.1:8765");

    const formatted = service.formatHttpError(
      await service.mappingGetJob({ job_id: "job_missing" }).catch((error) => error)
    );

    expect(formatted.code).toBe("JOB_NOT_FOUND");
    expect(formatted.statusCode).toBe(404);
  });
});
