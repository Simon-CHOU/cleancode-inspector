import { mkdtempSync } from "node:fs";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { createApplication } from "../../bootstrap/createApplication.js";
import { createMappingMcpService } from "../../mcp/createMappingMcpService.js";
import {
  ABSTRACT_TASK_ENGINE_FIXTURE,
  MINIMAL_JAVA_FIXTURE
} from "../fixtures/abstractTaskEngineFixture.js";
import { createAbstractTaskEngineLlmResponse, FakeLlmClient } from "../fixtures/fakeLlmClient.js";

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "mapping-mcp-e2e-"));
  tempDirs.push(dir);
  return dir;
}

async function waitForCompletion(
  service: ReturnType<typeof createMappingMcpService>,
  jobId: string
): Promise<void> {
  for (let index = 0; index < 50; index += 1) {
    const status = await service.mappingGetJob({ job_id: jobId });
    if (status.status === "completed" || status.status === "partial" || status.status === "failed") {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("job did not complete in time");
}

afterEach(() => {
  while (tempDirs.length) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("mapping MCP service", () => {
  it("runs happy path and returns schema-compatible mapping result", async () => {
    const app = createApplication({
      baseDir: createTempDir(),
      llmClient: new FakeLlmClient(createAbstractTaskEngineLlmResponse())
    });
    const service = createMappingMcpService(app);

    const created = await service.mappingCreateJob({
      file_name: "AbstractTaskEngine.java",
      language: "java",
      source_code: ABSTRACT_TASK_ENGINE_FIXTURE
    });

    await waitForCompletion(service, created.job_id);

    const result = await service.mappingGetResult({ job_id: created.job_id });

    expect(result.status).toBe("completed");
    expect(result.mapping_result.schema_version).toBe("1.0.0");
    expect(result.mapping_result.findings.length).toBeGreaterThan(0);
    expect(result.mapping_result.documents.some((item) => item.kind === "code")).toBe(true);
    expect(result.mapping_result.documents.some((item) => item.kind === "pdf")).toBe(true);
  }, 15000);

  it("returns partial result when no textbook evidence is retrieved", async () => {
    const app = createApplication({
      baseDir: createTempDir(),
      llmClient: new FakeLlmClient(createAbstractTaskEngineLlmResponse())
    });
    const service = createMappingMcpService(app);

    const created = await service.mappingCreateJob({
      file_name: "HelloWorld.java",
      language: "java",
      source_code: MINIMAL_JAVA_FIXTURE
    });

    await waitForCompletion(service, created.job_id);

    const result = await service.mappingGetResult({ job_id: created.job_id });

    expect(result.status).toBe("partial");
    expect(result.mapping_result.findings.length).toBe(0);
  }, 15000);
});
