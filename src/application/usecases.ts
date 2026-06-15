import type {
  MappingCreateJobInput,
  MappingCreateJobOutput,
  MappingGetJobOutput,
  MappingGetResultOutput
} from "../contracts/types.js";
import { DomainError } from "../domain/errors.js";
import { MappingJob, MappingResult, Submission } from "../domain/model.js";
import type {
  ArtifactStorePort,
  CodeObservationService,
  CorpusRepository,
  JavaParserPort,
  LlmSynthesisPort,
  MappingJobRepository,
  MappingSchemaValidatorPort,
  PdfCorpusRetrieverPort,
  ResultRepository,
  SubmissionRepository
} from "../domain/ports.js";

export class CreateMappingJobUseCase {
  constructor(
    private readonly dependencies: {
      submissionRepository: SubmissionRepository;
      jobRepository: MappingJobRepository;
      corpusRepository: CorpusRepository;
      scheduler: JobScheduler;
    }
  ) {}

  async execute(command: MappingCreateJobInput): Promise<MappingCreateJobOutput> {
    const corpus = await this.dependencies.corpusRepository.getActiveCorpus(command.corpus_id ?? "clean-code");
    if (!corpus) {
      throw new DomainError("CORPUS_NOT_FOUND", "Configured corpus does not exist.");
    }
    if (!corpus.ready) {
      throw new DomainError("CORPUS_NOT_READY", "Configured corpus is not ready.");
    }

    const submission = Submission.create({
      fileName: command.file_name,
      language: command.language,
      sourceCode: command.source_code
    });
    await this.dependencies.submissionRepository.save(submission);

    const job = MappingJob.create({
      submissionId: submission.id,
      corpusId: corpus.id,
      corpusVersionId: corpus.versionId
    });
    await this.dependencies.jobRepository.save(job);
    this.dependencies.scheduler.enqueue(job.id);

    return {
      job_id: job.id,
      status: "queued",
      accepted_at: job.createdAt,
      submission_id: submission.id
    };
  }
}

export class GetMappingJobUseCase {
  constructor(private readonly jobRepository: MappingJobRepository) {}

  async execute(query: { jobId: string }): Promise<MappingGetJobOutput> {
    const job = await this.jobRepository.getById(query.jobId);
    if (!job) {
      throw new DomainError("JOB_NOT_FOUND", "Mapping job does not exist.");
    }

    return {
      job_id: job.id,
      status: job.status,
      stage: job.stage,
      progress_percent: job.progressPercent,
      error_code: job.errorCode,
      error_message: job.errorMessage,
      result_id: job.resultId
    };
  }
}

export class GetMappingResultUseCase {
  constructor(
    private readonly jobRepository: MappingJobRepository,
    private readonly resultRepository: ResultRepository
  ) {}

  async execute(query: { jobId: string }): Promise<MappingGetResultOutput> {
    const job = await this.jobRepository.getById(query.jobId);
    if (!job) {
      throw new DomainError("JOB_NOT_FOUND", "Mapping job does not exist.");
    }
    const result = await this.resultRepository.getByJobId(query.jobId);
    if (!result) {
      throw new DomainError("RESULT_NOT_READY", "Mapping result is not ready yet.");
    }

    return {
      job_id: job.id,
      result_id: result.id,
      schema_version: result.schema.schema_version,
      status: result.status,
      mapping_result: result.schema
    };
  }
}

export class RunMappingPipelineUseCase {
  constructor(
    private readonly dependencies: {
      submissionRepository: SubmissionRepository;
      jobRepository: MappingJobRepository;
      resultRepository: ResultRepository;
      corpusRepository: CorpusRepository;
      artifactStore: ArtifactStorePort;
      parser: JavaParserPort;
      observationService: CodeObservationService;
      retriever: PdfCorpusRetrieverPort;
      synthesizer: LlmSynthesisPort;
      validator: MappingSchemaValidatorPort;
    }
  ) {}

  async execute(command: { jobId: string }): Promise<void> {
    const job = await this.dependencies.jobRepository.getById(command.jobId);
    if (!job) {
      throw new DomainError("JOB_NOT_FOUND", "Mapping job does not exist.");
    }
    const submission = await this.dependencies.submissionRepository.getById(job.submissionId);
    if (!submission) {
      throw new DomainError("SUBMISSION_NOT_FOUND", "Submission does not exist.");
    }
    const corpus = await this.dependencies.corpusRepository.getActiveCorpus(job.corpusId);
    if (!corpus) {
      throw new DomainError("CORPUS_NOT_FOUND", "Configured corpus does not exist.");
    }

    try {
      job.start();
      await this.dependencies.jobRepository.update(job);
      await this.dependencies.artifactStore.putText(
        `jobs/${job.id}/submission/source.java`,
        submission.sourceCode
      );

      job.advanceTo("parse", 20);
      await this.dependencies.jobRepository.update(job);
      const parsed = await this.dependencies.parser.parse(submission.sourceCode);
      const codeAnchors = await this.dependencies.observationService.extractCodeAnchors(
        parsed,
        submission.fileName
      );
      await this.dependencies.artifactStore.putText(
        `jobs/${job.id}/parse/anchors.json`,
        JSON.stringify(codeAnchors, null, 2)
      );

      job.advanceTo("analyze", 40);
      await this.dependencies.jobRepository.update(job);
      const observations = await this.dependencies.observationService.deriveObservations({
        submission,
        parsed,
        anchors: codeAnchors
      });
      const deduped = await this.dependencies.observationService.deduplicateObservations(observations);
      await this.dependencies.artifactStore.putText(
        `jobs/${job.id}/analyze/observations.json`,
        JSON.stringify(deduped, null, 2)
      );

      job.advanceTo("retrieve", 60);
      await this.dependencies.jobRepository.update(job);
      const evidenceCandidates = await this.dependencies.retriever.retrieve({
        corpus,
        observations: deduped
      });
      await this.dependencies.artifactStore.putText(
        `jobs/${job.id}/retrieve/evidence-candidates.json`,
        JSON.stringify(evidenceCandidates, null, 2)
      );

      job.advanceTo("synthesize", 80);
      await this.dependencies.jobRepository.update(job);
      const synthesis = await this.dependencies.synthesizer.synthesize({
        submissionId: submission.id,
        fileName: submission.fileName,
        sourceCode: submission.sourceCode,
        observations: deduped,
        codeAnchors,
        evidenceCandidates,
        corpusId: corpus.id,
        corpusVersionId: corpus.versionId,
        mappingProfileId: "default-mapping-profile",
        modelProfileId: "deterministic-local-profile"
      });
      await this.dependencies.artifactStore.putText(
        `jobs/${job.id}/synthesize/raw-output.json`,
        JSON.stringify(synthesis.schema, null, 2)
      );

      job.advanceTo("validate", 90);
      await this.dependencies.jobRepository.update(job);
      const validation = await this.dependencies.validator.validate(synthesis.schema);
      if (!validation.valid) {
        throw new DomainError(
          "SCHEMA_VALIDATION_FAILED",
          `Generated schema is invalid: ${validation.issues.join("; ")}`
        );
      }

      const result = MappingResult.create({
        jobId: job.id,
        status: synthesis.status,
        schema: synthesis.schema
      });
      await this.dependencies.resultRepository.save(result);
      await this.dependencies.artifactStore.putText(
        `jobs/${job.id}/publish/mapping-result.json`,
        JSON.stringify(result.schema, null, 2)
      );

      job.complete(result.id, synthesis.status);
      await this.dependencies.jobRepository.update(job);
    } catch (error) {
      const domainError =
        error instanceof DomainError
          ? error
          : new DomainError("PIPELINE_FAILED", error instanceof Error ? error.message : String(error));
      job.fail(domainError.code, domainError.message);
      await this.dependencies.jobRepository.update(job);
    }
  }
}

export interface JobScheduler {
  enqueue(jobId: string): void;
}

export class InProcessJobScheduler implements JobScheduler {
  constructor(private readonly runner: RunMappingPipelineUseCase) {}

  enqueue(jobId: string): void {
    setTimeout(() => {
      void this.runner.execute({ jobId });
    }, 0);
  }
}
