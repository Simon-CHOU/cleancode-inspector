import { access, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { Application } from "../bootstrap/createApplication.js";
import type {
  CodeObservation,
  MappingAnchor,
  MappingGetRuntimeOutput,
  MappingSchema,
  RetrievedEvidenceCandidate,
  RuntimeLogEntry
} from "../contracts/types.js";

const STAGE_ORDER = ["ingest", "parse", "analyze", "retrieve", "synthesize", "validate", "publish"] as const;

function stageRank(stage: RuntimeLogEntry["stage"]): number {
  return STAGE_ORDER.indexOf(stage);
}

function summarizePages(anchors: MappingAnchor[]): string {
  const pages = [...new Set(anchors.map((item) => item.locator.page).filter((item): item is number => typeof item === "number"))];
  return pages.length ? pages.map((item) => `p${item}`).join(", ") : "未命中明确页码";
}

function summarizeCodeSymbols(anchors: MappingAnchor[]): string[] {
  return anchors
    .map((item) => item.locator.symbol_path)
    .filter((item): item is string => Boolean(item))
    .slice(0, 4);
}

function summarizeCategories(observations: CodeObservation[]): string {
  return [...new Set(observations.map((item) => item.category))].join(" / ");
}

function buildPendingEntry(stage: RuntimeLogEntry["stage"], title: string, detail: string, source: RuntimeLogEntry["source"]): RuntimeLogEntry {
  return {
    id: `log-${stage}`,
    stage,
    status: "pending",
    source,
    title,
    detail
  };
}

async function readArtifactJson<T>(runtimeBaseDir: string, artifactPath: string): Promise<{ data?: T; updatedAt?: string }> {
  const fullPath = resolve(runtimeBaseDir, artifactPath);
  await access(fullPath);
  const [content, fileStat] = await Promise.all([readFile(fullPath, "utf8"), stat(fullPath)]);
  return {
    data: JSON.parse(content) as T,
    updatedAt: fileStat.mtime.toISOString()
  };
}

function buildStageStatus(input: {
  targetStage: RuntimeLogEntry["stage"];
  currentStage: RuntimeLogEntry["stage"];
  jobStatus: MappingGetRuntimeOutput["status"];
}): RuntimeLogEntry["status"] {
  const targetRank = stageRank(input.targetStage);
  const currentRank = stageRank(input.currentStage);

  if (input.jobStatus === "failed" && input.targetStage === input.currentStage) {
    return "failed";
  }
  if (currentRank > targetRank) {
    return "completed";
  }
  if (currentRank === targetRank) {
    if (input.jobStatus === "completed" || input.jobStatus === "partial") {
      return "completed";
    }
    if (input.jobStatus === "failed") {
      return "failed";
    }
    return "running";
  }
  return "pending";
}

export async function buildRuntimeLogs(input: {
  application: Application;
  runtimeBaseDir: string;
  jobId: string;
}): Promise<MappingGetRuntimeOutput> {
  const job = await input.application.getMappingJob.execute({ jobId: input.jobId });
  const runtimeBaseDir = resolve(input.runtimeBaseDir);
  const entries: RuntimeLogEntry[] = [];

  entries.push({
    id: "log-ingest",
    stage: "ingest",
    status: buildStageStatus({
      targetStage: "ingest",
      currentStage: job.stage,
      jobStatus: job.status
    }),
    source: "host",
    title: "接收上传文件",
    detail: "浏览器已提交 Java 源文件，系统正在创建 mapping job 并准备进入解析流程。"
  });

  try {
    const parseArtifact = await readArtifactJson<MappingAnchor[]>(
      runtimeBaseDir,
      join("jobs", input.jobId, "parse", "anchors.json")
    );
    const anchors = parseArtifact.data ?? [];
    entries.push({
      id: "log-parse",
      stage: "parse",
      status: "completed",
      source: "parser",
      title: "代码解析完成",
      detail: `已抽取 ${anchors.length} 个代码锚点，并建立后续 observation 的定位基础。`,
      lines: summarizeCodeSymbols(anchors).map((item) => `symbol: ${item}`),
      artifact_path: `jobs/${input.jobId}/parse/anchors.json`,
      updated_at: parseArtifact.updatedAt
    });
  } catch {
    entries.push(
      buildPendingEntry(
        "parse",
        "代码解析",
        "等待 Java parser 抽取方法、符号路径和代码锚点。",
        "parser"
      )
    );
  }

  try {
    const analyzeArtifact = await readArtifactJson<CodeObservation[]>(
      runtimeBaseDir,
      join("jobs", input.jobId, "analyze", "observations.json")
    );
    const observations = analyzeArtifact.data ?? [];
    entries.push({
      id: "log-analyze",
      stage: "analyze",
      status: "completed",
      source: "analysis",
      title: "代码观察已生成",
      detail: `已归纳 ${observations.length} 条 observation，类别覆盖 ${summarizeCategories(observations) || "暂无"}。`,
      lines: observations.slice(0, 4).map((item) => `${item.category}: ${item.summary}`),
      artifact_path: `jobs/${input.jobId}/analyze/observations.json`,
      updated_at: analyzeArtifact.updatedAt
    });
  } catch {
    entries.push(
      buildPendingEntry(
        "analyze",
        "代码观察归纳",
        "等待 observation service 总结职责、命名、抽象层级等代码观察。",
        "analysis"
      )
    );
  }

  try {
    const retrieveArtifact = await readArtifactJson<RetrievedEvidenceCandidate[]>(
      runtimeBaseDir,
      join("jobs", input.jobId, "retrieve", "evidence-candidates.json")
    );
    const candidates = retrieveArtifact.data ?? [];
    const totalAnchors = candidates.reduce((sum, item) => sum + item.anchors.length, 0);
    const allAnchors = candidates.flatMap((item) => item.anchors);
    entries.push({
      id: "log-retrieve",
      stage: "retrieve",
      status: "completed",
      source: "rag",
      title: "教材 RAG 检索完成",
      detail: `已产出 ${candidates.length} 组证据候选，共召回 ${totalAnchors} 个 PDF 锚点，命中页码 ${summarizePages(allAnchors)}。`,
      lines: candidates.slice(0, 4).map((item) => `${item.category}: ${item.anchors.length} 个锚点`),
      artifact_path: `jobs/${input.jobId}/retrieve/evidence-candidates.json`,
      updated_at: retrieveArtifact.updatedAt
    });
  } catch {
    entries.push({
      id: "log-retrieve",
      stage: "retrieve",
      status: buildStageStatus({
        targetStage: "retrieve",
        currentStage: job.stage,
        jobStatus: job.status
      }),
      source: "rag",
      title: "教材 RAG 检索",
      detail: "正在通过检索器召回教材片段，并尝试建立 observation 与 PDF anchors 的对应关系。"
    });
  }

  try {
    const synthesizeArtifact = await readArtifactJson<MappingSchema>(
      runtimeBaseDir,
      join("jobs", input.jobId, "synthesize", "raw-output.json")
    );
    const schema = synthesizeArtifact.data;
    entries.push({
      id: "log-synthesize",
      stage: "synthesize",
      status: "completed",
      source: "llm",
      title: "LLM synthesis 已产出草稿",
      detail: `已把代码观察与教材证据综合为 ${schema?.findings.length ?? 0} 条 finding 草稿，等待 schema 校验。`,
      lines: (schema?.findings ?? []).slice(0, 4).map((item) => `${item.severity}: ${item.title}`),
      artifact_path: `jobs/${input.jobId}/synthesize/raw-output.json`,
      updated_at: synthesizeArtifact.updatedAt
    });
  } catch {
    entries.push({
      id: "log-synthesize",
      stage: "synthesize",
      status: buildStageStatus({
        targetStage: "synthesize",
        currentStage: job.stage,
        jobStatus: job.status
      }),
      source: "llm",
      title: "LLM synthesis 正在进行",
      detail: "正在调用模型综合代码 observation 与教材证据，这一步通常是耗时最长的阶段。"
    });
  }

  const validateStatus = buildStageStatus({
    targetStage: "validate",
    currentStage: job.stage,
    jobStatus: job.status
  });
  entries.push({
    id: "log-validate",
    stage: "validate",
    status: validateStatus,
    source: "validator",
    title: "Schema 校验",
    detail:
      validateStatus === "completed"
        ? "结构化 mapping schema 已通过校验。"
        : validateStatus === "failed"
          ? `校验阶段失败：${job.error_message ?? job.error_code ?? "未知错误"}`
          : "等待 validator 校验字段完整性、引用一致性和 schema 合法性。"
  });

  try {
    const publishArtifact = await readArtifactJson<MappingSchema>(
      runtimeBaseDir,
      join("jobs", input.jobId, "publish", "mapping-result.json")
    );
    const schema = publishArtifact.data;
    entries.push({
      id: "log-publish",
      stage: "publish",
      status: "completed",
      source: "publisher",
      title: "结果已发布",
      detail: `最终结果已写入 artifact store，可视化结果共包含 ${schema?.findings.length ?? 0} 条 finding。`,
      lines: [
        `documents: ${schema?.documents.length ?? 0}`,
        `anchors: ${schema?.anchors.length ?? 0}`,
        `evidence_links: ${schema?.evidence_links.length ?? 0}`
      ],
      artifact_path: `jobs/${input.jobId}/publish/mapping-result.json`,
      updated_at: publishArtifact.updatedAt
    });
  } catch {
    entries.push({
      id: "log-publish",
      stage: "publish",
      status: buildStageStatus({
        targetStage: "publish",
        currentStage: job.stage,
        jobStatus: job.status
      }),
      source: "publisher",
      title: "结果发布",
      detail:
        job.status === "completed" || job.status === "partial"
          ? "结果已完成，等待 viewer 拉取最终 schema。"
          : "等待生成最终 mapping-result.json 并发布到 viewer。"
    });
  }

  if (job.status === "failed") {
    entries.push({
      id: "log-failed",
      stage: job.stage,
      status: "failed",
      source: "host",
      title: "任务失败",
      detail: job.error_message ?? job.error_code ?? "未知错误"
    });
  }

  return {
    job_id: job.job_id,
    status: job.status,
    stage: job.stage,
    progress_percent: job.progress_percent,
    entries
  };
}
