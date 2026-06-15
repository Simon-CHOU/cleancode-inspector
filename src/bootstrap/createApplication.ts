import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  CreateMappingJobUseCase,
  GetMappingJobUseCase,
  GetMappingResultUseCase,
  InProcessJobScheduler,
  RunMappingPipelineUseCase
} from "../application/usecases.js";
import { resolveDeepSeekConfig, resolvePdfPath } from "./config.js";
import {
  BasicMappingSchemaValidatorAdapter,
  DeepSeekLlmSynthesisAdapter,
  ExternalDeepSeekChatClient,
  ExternalPdfReaderMcpClient,
  HeuristicCodeObservationService,
  HybridPdfCorpusRetrieverAdapter,
  type LlmChatClientPort,
  McpPdfCorpusRetrieverAdapter,
  SimpleJavaParserAdapter,
  StaticPdfCorpusRetrieverAdapter,
  hasLocalPdf,
  type PdfReaderMcpClientPort
} from "../infrastructure/adapters.js";
import {
  FileSystemArtifactStore,
  SqliteDatabase,
  SqliteMappingJobRepository,
  SqliteResultRepository,
  SqliteSubmissionRepository,
  StaticCorpusRepository
} from "../infrastructure/sqlite.js";

export interface Application {
  createMappingJob: CreateMappingJobUseCase;
  getMappingJob: GetMappingJobUseCase;
  getMappingResult: GetMappingResultUseCase;
  dispose(): Promise<void>;
}

export function createApplication(options?: {
  baseDir?: string;
  pdfPath?: string;
  pdfReaderClient?: PdfReaderMcpClientPort;
  llmClient?: LlmChatClientPort;
}): Application {
  const baseDir = resolve(options?.baseDir ?? join(process.cwd(), ".runtime"));
  mkdirSync(baseDir, { recursive: true });
  const pdfPath = resolvePdfPath(options?.pdfPath);

  const db = new SqliteDatabase(join(baseDir, "mapping.db"));
  const submissionRepository = new SqliteSubmissionRepository(db);
  const jobRepository = new SqliteMappingJobRepository(db);
  const resultRepository = new SqliteResultRepository(db);
  const corpusRepository = new StaticCorpusRepository(pdfPath);
  const artifactStore = new FileSystemArtifactStore(baseDir);
  const parser = new SimpleJavaParserAdapter();
  const observationService = new HeuristicCodeObservationService();
  const staticRetriever = new StaticPdfCorpusRetrieverAdapter();
  const pdfReaderClient = options?.pdfReaderClient ?? new ExternalPdfReaderMcpClient();
  const mcpRetriever = new McpPdfCorpusRetrieverAdapter(pdfReaderClient);
  const retriever = hasLocalPdf(pdfPath)
    ? new HybridPdfCorpusRetrieverAdapter(mcpRetriever, staticRetriever)
    : staticRetriever;
  const deepSeekConfig = options?.llmClient ? null : resolveDeepSeekConfig();
  const llmClient = options?.llmClient ?? new ExternalDeepSeekChatClient(deepSeekConfig!);
  const synthesizer = new DeepSeekLlmSynthesisAdapter(llmClient, {
    model: deepSeekConfig?.model ?? "deepseek-v4-flash"
  });
  const validator = new BasicMappingSchemaValidatorAdapter();

  const runMappingPipeline = new RunMappingPipelineUseCase({
    submissionRepository,
    jobRepository,
    resultRepository,
    corpusRepository,
    artifactStore,
    parser,
    observationService,
    retriever,
    synthesizer,
    validator
  });

  const scheduler = new InProcessJobScheduler(runMappingPipeline);

  return {
    createMappingJob: new CreateMappingJobUseCase({
      submissionRepository,
      jobRepository,
      corpusRepository,
      scheduler
    }),
    getMappingJob: new GetMappingJobUseCase(jobRepository),
    getMappingResult: new GetMappingResultUseCase(jobRepository, resultRepository),
    async dispose() {
      await pdfReaderClient.close();
      await llmClient.close();
    }
  };
}
