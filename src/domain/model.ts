import { createHash, randomUUID } from "node:crypto";

import type { JobStatus, MappingSchema, MappingStage } from "../contracts/types.js";
import { DomainError } from "./errors.js";

interface SubmissionProps {
  id: string;
  fileName: string;
  language: "java";
  sourceCode: string;
  checksum: string;
  createdAt: string;
}

interface MappingJobProps {
  id: string;
  submissionId: string;
  corpusId: string;
  corpusVersionId: string;
  status: JobStatus;
  stage: MappingStage;
  progressPercent: number;
  errorCode?: string;
  errorMessage?: string;
  resultId?: string;
  createdAt: string;
  updatedAt: string;
}

interface MappingResultProps {
  id: string;
  jobId: string;
  status: "completed" | "partial";
  schema: MappingSchema;
  checksum: string;
  createdAt: string;
}

export class Submission {
  readonly id: string;

  readonly fileName: string;

  readonly language: "java";

  readonly sourceCode: string;

  readonly checksum: string;

  readonly createdAt: string;

  private constructor(props: SubmissionProps) {
    this.id = props.id;
    this.fileName = props.fileName;
    this.language = props.language;
    this.sourceCode = props.sourceCode;
    this.checksum = props.checksum;
    this.createdAt = props.createdAt;
  }

  static create(input: {
    fileName: string;
    language: "java";
    sourceCode: string;
  }): Submission {
    if (!input.fileName.endsWith(".java")) {
      throw new DomainError("INVALID_INPUT_EXTENSION", "Only single .java files are accepted.");
    }

    if (!input.sourceCode.trim()) {
      throw new DomainError("EMPTY_SOURCE_CODE", "Source code must not be empty.");
    }

    const normalizedSource = input.sourceCode.replace(/\r\n/g, "\n").trimEnd();
    return new Submission({
      id: `sub_${randomUUID()}`,
      fileName: input.fileName,
      language: input.language,
      sourceCode: normalizedSource,
      checksum: createHash("sha256").update(normalizedSource).digest("hex"),
      createdAt: new Date().toISOString()
    });
  }

  static hydrate(props: SubmissionProps): Submission {
    return new Submission(props);
  }

  toJSON(): SubmissionProps {
    return {
      id: this.id,
      fileName: this.fileName,
      language: this.language,
      sourceCode: this.sourceCode,
      checksum: this.checksum,
      createdAt: this.createdAt
    };
  }
}

export class MappingJob {
  readonly id: string;

  readonly submissionId: string;

  readonly corpusId: string;

  readonly corpusVersionId: string;

  status: JobStatus;

  stage: MappingStage;

  progressPercent: number;

  errorCode?: string;

  errorMessage?: string;

  resultId?: string;

  readonly createdAt: string;

  updatedAt: string;

  private constructor(props: MappingJobProps) {
    this.id = props.id;
    this.submissionId = props.submissionId;
    this.corpusId = props.corpusId;
    this.corpusVersionId = props.corpusVersionId;
    this.status = props.status;
    this.stage = props.stage;
    this.progressPercent = props.progressPercent;
    this.errorCode = props.errorCode;
    this.errorMessage = props.errorMessage;
    this.resultId = props.resultId;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  static create(input: {
    submissionId: string;
    corpusId: string;
    corpusVersionId: string;
  }): MappingJob {
    const now = new Date().toISOString();
    return new MappingJob({
      id: `job_${randomUUID()}`,
      submissionId: input.submissionId,
      corpusId: input.corpusId,
      corpusVersionId: input.corpusVersionId,
      status: "queued",
      stage: "ingest",
      progressPercent: 0,
      createdAt: now,
      updatedAt: now
    });
  }

  static hydrate(props: MappingJobProps): MappingJob {
    return new MappingJob(props);
  }

  start(): void {
    this.ensureNotTerminal();
    this.status = "running";
    this.stage = "ingest";
    this.progressPercent = 5;
    this.updatedAt = new Date().toISOString();
  }

  advanceTo(stage: MappingStage, progressPercent: number): void {
    this.ensureNotTerminal();
    this.stage = stage;
    this.progressPercent = progressPercent;
    this.updatedAt = new Date().toISOString();
  }

  complete(resultId: string, status: "completed" | "partial"): void {
    this.ensureNotTerminal();
    this.status = status;
    this.stage = "publish";
    this.progressPercent = 100;
    this.resultId = resultId;
    this.updatedAt = new Date().toISOString();
  }

  fail(code: string, message: string): void {
    this.ensureNotTerminal();
    this.status = "failed";
    this.errorCode = code;
    this.errorMessage = message;
    this.updatedAt = new Date().toISOString();
  }

  toJSON(): MappingJobProps {
    return {
      id: this.id,
      submissionId: this.submissionId,
      corpusId: this.corpusId,
      corpusVersionId: this.corpusVersionId,
      status: this.status,
      stage: this.stage,
      progressPercent: this.progressPercent,
      errorCode: this.errorCode,
      errorMessage: this.errorMessage,
      resultId: this.resultId,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }

  private ensureNotTerminal(): void {
    if (this.status === "completed" || this.status === "failed" || this.status === "partial") {
      throw new DomainError("INVALID_JOB_TRANSITION", "Terminal jobs cannot transition again.");
    }
  }
}

export class MappingResult {
  readonly id: string;

  readonly jobId: string;

  readonly status: "completed" | "partial";

  readonly schema: MappingSchema;

  readonly checksum: string;

  readonly createdAt: string;

  private constructor(props: MappingResultProps) {
    this.id = props.id;
    this.jobId = props.jobId;
    this.status = props.status;
    this.schema = props.schema;
    this.checksum = props.checksum;
    this.createdAt = props.createdAt;
  }

  static create(input: {
    jobId: string;
    status: "completed" | "partial";
    schema: MappingSchema;
  }): MappingResult {
    const serialized = JSON.stringify(input.schema);
    return new MappingResult({
      id: `result_${randomUUID()}`,
      jobId: input.jobId,
      status: input.status,
      schema: input.schema,
      checksum: createHash("sha256").update(serialized).digest("hex"),
      createdAt: new Date().toISOString()
    });
  }

  static hydrate(props: MappingResultProps): MappingResult {
    return new MappingResult(props);
  }

  toJSON(): MappingResultProps {
    return {
      id: this.id,
      jobId: this.jobId,
      status: this.status,
      schema: this.schema,
      checksum: this.checksum,
      createdAt: this.createdAt
    };
  }
}

export interface Corpus {
  id: string;
  versionId: string;
  title: string;
  pdfPath: string;
  ready: boolean;
}
