import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { MappingSchema } from "../contracts/types.js";
import type { Corpus } from "../domain/model.js";
import { MappingJob, MappingResult, Submission } from "../domain/model.js";
import type {
  ArtifactStorePort,
  CorpusRepository,
  MappingJobRepository,
  ResultRepository,
  SubmissionRepository
} from "../domain/ports.js";

export class SqliteDatabase {
  readonly connection: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.connection = new DatabaseSync(dbPath);
    this.connection.exec(`
      CREATE TABLE IF NOT EXISTS submissions (
        id TEXT PRIMARY KEY,
        file_name TEXT NOT NULL,
        language TEXT NOT NULL,
        source_code TEXT NOT NULL,
        checksum TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        submission_id TEXT NOT NULL,
        corpus_id TEXT NOT NULL,
        corpus_version_id TEXT NOT NULL,
        status TEXT NOT NULL,
        stage TEXT NOT NULL,
        progress_percent INTEGER NOT NULL,
        error_code TEXT,
        error_message TEXT,
        result_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS results (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        status TEXT NOT NULL,
        schema_json TEXT NOT NULL,
        checksum TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }
}

export class SqliteSubmissionRepository implements SubmissionRepository {
  constructor(private readonly db: SqliteDatabase) {}

  async save(submission: Submission): Promise<void> {
    this.db.connection
      .prepare(
        `INSERT OR REPLACE INTO submissions (id, file_name, language, source_code, checksum, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        submission.id,
        submission.fileName,
        submission.language,
        submission.sourceCode,
        submission.checksum,
        submission.createdAt
      );
  }

  async getById(id: string): Promise<Submission | null> {
    const row = this.db.connection
      .prepare("SELECT * FROM submissions WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    if (!row) {
      return null;
    }
    return Submission.hydrate({
      id: String(row.id),
      fileName: String(row.file_name),
      language: "java",
      sourceCode: String(row.source_code),
      checksum: String(row.checksum),
      createdAt: String(row.created_at)
    });
  }
}

export class SqliteMappingJobRepository implements MappingJobRepository {
  constructor(private readonly db: SqliteDatabase) {}

  async save(job: MappingJob): Promise<void> {
    const snapshot = job.toJSON();
    this.db.connection
      .prepare(
        `INSERT OR REPLACE INTO jobs
         (id, submission_id, corpus_id, corpus_version_id, status, stage, progress_percent, error_code, error_message, result_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        snapshot.id,
        snapshot.submissionId,
        snapshot.corpusId,
        snapshot.corpusVersionId,
        snapshot.status,
        snapshot.stage,
        snapshot.progressPercent,
        snapshot.errorCode ?? null,
        snapshot.errorMessage ?? null,
        snapshot.resultId ?? null,
        snapshot.createdAt,
        snapshot.updatedAt
      );
  }

  async getById(id: string): Promise<MappingJob | null> {
    const row = this.db.connection.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) {
      return null;
    }
    return MappingJob.hydrate({
      id: String(row.id),
      submissionId: String(row.submission_id),
      corpusId: String(row.corpus_id),
      corpusVersionId: String(row.corpus_version_id),
      status: String(row.status) as MappingJob["status"],
      stage: String(row.stage) as MappingJob["stage"],
      progressPercent: Number(row.progress_percent),
      errorCode: row.error_code ? String(row.error_code) : undefined,
      errorMessage: row.error_message ? String(row.error_message) : undefined,
      resultId: row.result_id ? String(row.result_id) : undefined,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    });
  }

  async update(job: MappingJob): Promise<void> {
    await this.save(job);
  }
}

export class SqliteResultRepository implements ResultRepository {
  constructor(private readonly db: SqliteDatabase) {}

  async save(result: MappingResult): Promise<void> {
    const snapshot = result.toJSON();
    this.db.connection
      .prepare(
        `INSERT OR REPLACE INTO results (id, job_id, status, schema_json, checksum, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        snapshot.id,
        snapshot.jobId,
        snapshot.status,
        JSON.stringify(snapshot.schema),
        snapshot.checksum,
        snapshot.createdAt
      );
  }

  async getByJobId(jobId: string): Promise<MappingResult | null> {
    const row = this.db.connection.prepare("SELECT * FROM results WHERE job_id = ?").get(jobId) as
      | Record<string, unknown>
      | undefined;
    if (!row) {
      return null;
    }
    return MappingResult.hydrate({
      id: String(row.id),
      jobId: String(row.job_id),
      status: String(row.status) as "completed" | "partial",
      schema: JSON.parse(String(row.schema_json)) as MappingSchema,
      checksum: String(row.checksum),
      createdAt: String(row.created_at)
    });
  }
}

export class StaticCorpusRepository implements CorpusRepository {
  private readonly corpus: Corpus;

  constructor(pdfPath: string) {
    this.corpus = {
      id: "clean-code",
      versionId: "clean-code@1",
      title: "Clean Code",
      pdfPath,
      ready: true
    };
  }

  async getActiveCorpus(corpusId: string): Promise<Corpus | null> {
    if (corpusId !== this.corpus.id) {
      return null;
    }
    return this.corpus;
  }
}

export class FileSystemArtifactStore implements ArtifactStorePort {
  constructor(private readonly baseDir: string) {}

  async putText(path: string, content: string): Promise<void> {
    const fullPath = join(this.baseDir, path);
    mkdirSync(dirname(fullPath), { recursive: true });
    await import("node:fs/promises").then(({ writeFile }) => writeFile(fullPath, content, "utf8"));
  }

  async getText(path: string): Promise<string> {
    const fullPath = join(this.baseDir, path);
    return import("node:fs/promises").then(({ readFile }) => readFile(fullPath, "utf8"));
  }
}
