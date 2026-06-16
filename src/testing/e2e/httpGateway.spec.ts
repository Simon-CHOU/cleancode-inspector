import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { createApplication, type Application } from "../../bootstrap/createApplication.js";
import type { MappingGetResultOutput } from "../../contracts/types.js";
import { startHttpServer, type RunningHttpServer } from "../../http/server.js";
import { ABSTRACT_TASK_ENGINE_FIXTURE } from "../fixtures/abstractTaskEngineFixture.js";
import { createAbstractTaskEngineLlmResponse, FakeLlmClient } from "../fixtures/fakeLlmClient.js";

const tempDirs: string[] = [];
const applications: Application[] = [];
const servers: RunningHttpServer[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "mapping-http-gateway-"));
  tempDirs.push(dir);
  return dir;
}

function createTempPdf(baseDir: string): string {
  const pdfPath = join(baseDir, "Clean_Code.pdf");
  writeFileSync(
    pdfPath,
    Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n", "utf8")
  );
  return pdfPath;
}

class FastFakePdfReaderClient {
  async searchPdf(): Promise<{ results: [] }> {
    return { results: [] };
  }

  async close(): Promise<void> {}
}

interface HttpJobEnvelope {
  job: {
    job_id: string;
    status: string;
    stage: string;
    progress_percent: number;
  };
  viewer_url: string;
}

async function waitForCompletion(baseUrl: string, jobId: string): Promise<HttpJobEnvelope> {
  for (let index = 0; index < 120; index += 1) {
    const response = await fetch(`${baseUrl}/api/mapping/jobs/${encodeURIComponent(jobId)}`);
    const payload = await response.json() as HttpJobEnvelope;
    if (payload.job.status === "completed" || payload.job.status === "partial" || payload.job.status === "failed") {
      return payload;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("job did not complete in time");
}

afterEach(async () => {
  while (servers.length) {
    await servers.pop()!.close();
  }
  while (applications.length) {
    await applications.pop()!.dispose();
  }
  while (tempDirs.length) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("HTTP gateway", () => {
  it("creates jobs, polls status, serves result, and exposes viewer URLs", async () => {
    const baseDir = createTempDir();
    const pdfPath = createTempPdf(baseDir);
    const app = createApplication({
      baseDir,
      pdfPath,
      pdfReaderClient: new FastFakePdfReaderClient(),
      llmClient: new FakeLlmClient(createAbstractTaskEngineLlmResponse())
    });
    applications.push(app);

    const server = await startHttpServer({
      application: app,
      host: "127.0.0.1",
      port: 0,
      rootDir: process.cwd(),
      pdfPath
    });
    servers.push(server);

    const createResponse = await fetch(`${server.baseUrl}/api/mapping/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file_name: "AbstractTaskEngine.java",
        language: "java",
        source_code: ABSTRACT_TASK_ENGINE_FIXTURE
      })
    });
    const created = await createResponse.json() as HttpJobEnvelope;

    expect(createResponse.status).toBe(202);
    expect(created.job.job_id).toMatch(/^job_/);
    expect(created.viewer_url).toContain(created.job.job_id);

    const status = await waitForCompletion(server.baseUrl, created.job.job_id);
    expect(["completed", "partial"]).toContain(status.job.status);

    const resultResponse = await fetch(
      `${server.baseUrl}/api/mapping/jobs/${encodeURIComponent(created.job.job_id)}/result`
    );
    const result = await resultResponse.json() as MappingGetResultOutput;

    expect(resultResponse.status).toBe(200);
    expect(result.mapping_result.schema_version).toBe("1.0.0");

    const viewerResponse = await fetch(created.viewer_url);
    expect(viewerResponse.status).toBe(200);

    const pdfResponse = await fetch(`${server.baseUrl}/api/corpus/pdf`);
    expect(pdfResponse.status).toBe(200);
    expect(pdfResponse.headers.get("content-type")).toContain("application/pdf");

    const pdfAnchors = result.mapping_result.anchors.filter((item) => item.kind === "pdf_span");
    expect(pdfAnchors.length).toBeGreaterThan(0);
    expect(pdfAnchors[0]?.deep_link.startsWith("/api/corpus/pdf#page=")).toBe(true);

    const logsResponse = await fetch(
      `${server.baseUrl}/api/mapping/jobs/${encodeURIComponent(created.job.job_id)}/logs`
    );
    const runtime = await logsResponse.json() as {
      entries: Array<{
        stage: string;
        source: string;
        title: string;
      }>;
    };

    expect(logsResponse.status).toBe(200);
    expect(runtime.entries.some((item) => item.stage === "retrieve" && item.source === "rag")).toBe(true);
    expect(runtime.entries.some((item) => item.stage === "synthesize" && item.source === "llm")).toBe(true);
    expect(runtime.entries.some((item) => item.stage === "publish" && item.title.includes("发布"))).toBe(true);

    const healthResponse = await fetch(`${server.baseUrl}/healthz`);
    expect(healthResponse.status).toBe(200);
  }, 15000);
});
