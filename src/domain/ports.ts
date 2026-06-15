import type {
  CodeObservation,
  MappingAnchor,
  MappingSchema,
  ParsedJavaFile,
  RetrievedEvidenceCandidate,
  SynthesisInput,
  SynthesisOutput,
  ValidationResult
} from "../contracts/types.js";
import type { Corpus, MappingJob, MappingResult, Submission } from "./model.js";

export interface SubmissionRepository {
  save(submission: Submission): Promise<void>;
  getById(id: string): Promise<Submission | null>;
}

export interface MappingJobRepository {
  save(job: MappingJob): Promise<void>;
  getById(id: string): Promise<MappingJob | null>;
  update(job: MappingJob): Promise<void>;
}

export interface ResultRepository {
  save(result: MappingResult): Promise<void>;
  getByJobId(jobId: string): Promise<MappingResult | null>;
}

export interface CorpusRepository {
  getActiveCorpus(corpusId: string): Promise<Corpus | null>;
}

export interface ArtifactStorePort {
  putText(path: string, content: string): Promise<void>;
  getText(path: string): Promise<string>;
}

export interface JavaParserPort {
  parse(sourceCode: string): Promise<ParsedJavaFile>;
}

export interface CodeObservationService {
  extractCodeAnchors(parsed: ParsedJavaFile, fileName: string): Promise<MappingAnchor[]>;
  deriveObservations(input: {
    submission: Submission;
    parsed: ParsedJavaFile;
    anchors: MappingAnchor[];
  }): Promise<CodeObservation[]>;
  deduplicateObservations(observations: CodeObservation[]): Promise<CodeObservation[]>;
}

export interface PdfCorpusRetrieverPort {
  retrieve(input: {
    corpus: Corpus;
    observations: CodeObservation[];
  }): Promise<RetrievedEvidenceCandidate[]>;
}

export interface LlmSynthesisPort {
  synthesize(input: SynthesisInput): Promise<SynthesisOutput>;
}

export interface MappingSchemaValidatorPort {
  validate(result: MappingSchema): Promise<ValidationResult>;
}

export interface DisposablePort {
  close(): Promise<void>;
}
