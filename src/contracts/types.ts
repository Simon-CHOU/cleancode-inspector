export type JobStatus = "queued" | "running" | "completed" | "failed" | "partial";

export type MappingStage =
  | "ingest"
  | "parse"
  | "analyze"
  | "retrieve"
  | "synthesize"
  | "validate"
  | "publish";

export interface MappingTask {
  id: string;
  goal: string;
  created_at: string;
  language: string;
}

export interface MappingDocument {
  id: string;
  kind: "pdf" | "code";
  title: string;
  path: string;
  page_count?: number;
  language?: string;
  content?: string;
}

export interface MappingAnchor {
  id: string;
  document_id: string;
  kind: "pdf_span" | "code_span";
  locator: {
    page?: number;
    bbox?: number[] | null;
    quote?: string;
    file_path?: string;
    line_start?: number;
    line_end?: number;
    symbol_path?: string;
  };
  deep_link: string;
  quote: string;
  confidence: number;
}

export interface MappingConcept {
  id: string;
  name: string;
  category: string;
  chapter_hint: string;
  keywords: string[];
  summary: string;
}

export interface MappingFinding {
  id: string;
  title: string;
  summary: string;
  severity: "high" | "medium" | "low";
  confidence: number;
  concept_ids: string[];
  primary_code_anchor_ids: string[];
  primary_pdf_anchor_ids: string[];
  tags: string[];
  representative_evidence_ids: string[];
}

export interface MappingEvidenceLink {
  id: string;
  finding_id: string;
  anchor_id: string;
  relation: "observed_in_code" | "supported_by_book";
  score: number;
  importance_score: number;
  novelty_score: number;
  representative: boolean;
  rationale: string;
}

export interface MappingCrossRef {
  id: string;
  from_type: "finding" | "concept";
  from_id: string;
  to_type: "finding" | "concept";
  to_id: string;
  relation: string;
  score: number;
  reason: string;
}

export interface MappingUiIndexes {
  default_finding_order: string[];
  finding_groups: Array<{
    id: string;
    title: string;
    finding_ids: string[];
  }>;
  book_coverage: Array<{
    concept_id: string;
    matched_pages: number[];
    match_count: number;
  }>;
  default_selected: {
    finding_id: string;
    evidence_id: string;
  };
  hero: {
    title: string;
    description: string;
    pills: string[];
  };
  summary: {
    title: string;
    text: string;
  };
}

export interface MappingSchema {
  schema_version: string;
  task: MappingTask;
  documents: MappingDocument[];
  anchors: MappingAnchor[];
  concepts: MappingConcept[];
  findings: MappingFinding[];
  evidence_links: MappingEvidenceLink[];
  cross_refs: MappingCrossRef[];
  ui_indexes: MappingUiIndexes;
}

export interface MappingCreateJobInput {
  file_name: string;
  language: "java";
  source_code: string;
  corpus_id?: string;
  mapping_profile_id?: string;
  model_profile_id?: string;
}

export interface MappingCreateJobOutput {
  job_id: string;
  status: "queued";
  accepted_at: string;
  submission_id: string;
}

export interface MappingGetJobInput {
  job_id: string;
}

export interface MappingGetJobOutput {
  job_id: string;
  status: JobStatus;
  stage: MappingStage;
  progress_percent: number;
  error_code?: string;
  error_message?: string;
  result_id?: string;
}

export interface MappingGetResultInput {
  job_id: string;
}

export interface MappingGetResultOutput {
  job_id: string;
  result_id: string;
  schema_version: string;
  status: "completed" | "partial";
  mapping_result: MappingSchema;
}

export interface RuntimeLogEntry {
  id: string;
  stage: MappingStage;
  status: "completed" | "running" | "pending" | "failed";
  source: "host" | "parser" | "analysis" | "rag" | "llm" | "validator" | "publisher";
  title: string;
  detail: string;
  lines?: string[];
  artifact_path?: string;
  updated_at?: string;
}

export interface MappingGetRuntimeOutput {
  job_id: string;
  status: JobStatus;
  stage: MappingStage;
  progress_percent: number;
  entries: RuntimeLogEntry[];
}

export interface ParsedMethod {
  name: string;
  startLine: number;
  endLine: number;
  body: string;
}

export interface ParsedJavaFile {
  className: string | null;
  lines: string[];
  methods: ParsedMethod[];
}

export interface CodeObservation {
  observation_id: string;
  submission_id: string;
  code_anchor_ids: string[];
  category:
    | "function_design"
    | "abstraction_level"
    | "naming"
    | "magic_number"
    | "comments"
    | "class_responsibility";
  summary: string;
  confidence: number;
}

export interface RetrievedEvidenceCandidate {
  observation_id: string;
  category: CodeObservation["category"];
  anchors: MappingAnchor[];
}

export interface SynthesisInput {
  submissionId: string;
  fileName: string;
  sourceCode: string;
  observations: CodeObservation[];
  codeAnchors: MappingAnchor[];
  evidenceCandidates: RetrievedEvidenceCandidate[];
  corpusId: string;
  corpusVersionId: string;
  mappingProfileId: string;
  modelProfileId: string;
}

export interface SynthesisOutput {
  schema: MappingSchema;
  status: "completed" | "partial";
}

export interface ValidationResult {
  valid: boolean;
  issues: string[];
}
