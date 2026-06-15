import { basename } from "node:path";
import { accessSync, constants as fsConstants } from "node:fs";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";

import type {
  CodeObservation,
  MappingAnchor,
  MappingConcept,
  MappingCrossRef,
  MappingEvidenceLink,
  MappingFinding,
  MappingSchema,
  ParsedJavaFile,
  RetrievedEvidenceCandidate,
  SynthesisInput,
  SynthesisOutput
} from "../contracts/types.js";
import type { Submission } from "../domain/model.js";
import type {
  CodeObservationService,
  JavaParserPort,
  LlmSynthesisPort,
  MappingSchemaValidatorPort,
  PdfCorpusRetrieverPort
} from "../domain/ports.js";
import { BasicSchemaValidationService, ObservationDeduper } from "../domain/services.js";

interface BookEvidenceTemplate {
  concept: MappingConcept;
  anchors: MappingAnchor[];
}

interface PdfReaderSearchMatch {
  id?: string;
  page?: number;
  text?: string;
  snippet?: string;
  bounding_box?: {
    left: number;
    bottom: number;
    right: number;
    top: number;
  };
}

interface PdfReaderSearchResponse {
  results?: Array<{
    source?: string;
    success?: boolean;
    matches?: PdfReaderSearchMatch[];
  }>;
}

export interface PdfReaderMcpClientPort {
  searchPdf(input: {
    path: string;
    query: string;
    maxPages?: number;
    maxMatchesPerSource?: number;
    contextChars?: number;
  }): Promise<PdfReaderSearchResponse>;
  close(): Promise<void>;
}

export interface LlmChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmChatClientPort {
  completeJson(input: {
    messages: LlmChatMessage[];
    temperature?: number;
  }): Promise<string>;
  close(): Promise<void>;
}

export interface DeepSeekLlmConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

const BOOK_EVIDENCE_BY_CATEGORY: Record<string, BookEvidenceTemplate> = {
  function_design: {
    concept: {
      id: "concept-function-design",
      name: "函数设计",
      category: "function-design",
      chapter_hint: "Functions",
      keywords: ["do one thing", "abstraction", "stepdown"],
      summary: "函数应只承担单一职责，并保持一致的抽象层级。"
    },
    anchors: [
      pdfAnchor("anchor-pdf-p66", 66, "FUNCTIONS SHOULD DO ONE THING. THEY SHOULD DO IT WELL."),
      pdfAnchor("anchor-pdf-p67", 67, "One Level of Abstraction per Function"),
      pdfAnchor("anchor-pdf-p68", 68, "Reading Code from Top to Bottom: The Stepdown Rule")
    ]
  },
  abstraction_level: {
    concept: {
      id: "concept-function-design",
      name: "函数设计",
      category: "function-design",
      chapter_hint: "Functions",
      keywords: ["do one thing", "abstraction", "stepdown"],
      summary: "函数应只承担单一职责，并保持一致的抽象层级。"
    },
    anchors: [
      pdfAnchor("anchor-pdf-p67", 67, "One Level of Abstraction per Function"),
      pdfAnchor("anchor-pdf-p68", 68, "Reading Code from Top to Bottom: The Stepdown Rule")
    ]
  },
  naming: {
    concept: {
      id: "concept-naming",
      name: "命名与语义",
      category: "naming",
      chapter_hint: "Meaningful Names",
      keywords: ["intention-revealing", "avoid disinformation"],
      summary: "命名应直接表达真实语义，避免误导。"
    },
    anchors: [
      pdfAnchor("anchor-pdf-p49", 49, "The name of a variable, function, or class, should answer all the big questions."),
      pdfAnchor("anchor-pdf-p50", 50, "Avoid Disinformation")
    ]
  },
  magic_number: {
    concept: {
      id: "concept-constants",
      name: "常量与可读性",
      category: "readability",
      chapter_hint: "General",
      keywords: ["magic numbers", "named constants"],
      summary: "避免魔法值，用常量或枚举显式表达业务含义。"
    },
    anchors: [pdfAnchor("anchor-pdf-p331", 331, "Replace Magic Numbers with Named Constants")]
  },
  comments: {
    concept: {
      id: "concept-comments",
      name: "注释与自解释代码",
      category: "comments",
      chapter_hint: "Comments",
      keywords: ["comments are failures", "redundant comments"],
      summary: "优先让代码自解释，避免冗余或补救式注释。"
    },
    anchors: [
      pdfAnchor("anchor-pdf-p85", 85, "Comments are always failures."),
      pdfAnchor("anchor-pdf-p86", 86, "Explain Yourself in Code"),
      pdfAnchor("anchor-pdf-p91", 91, "Redundant Comments")
    ]
  },
  class_responsibility: {
    concept: {
      id: "concept-class-responsibility",
      name: "类职责边界",
      category: "class-design",
      chapter_hint: "Classes",
      keywords: ["reason to change", "single responsibility"],
      summary: "类和模块应尽量只承载一个变化原因。"
    },
    anchors: [
      pdfAnchor("anchor-pdf-p169", 169, "and only one, reason to change."),
      pdfAnchor("anchor-pdf-p171", 171, "has a single reason to change")
    ]
  }
};

const SEARCH_QUERY_BY_CATEGORY: Record<string, string[]> = {
  function_design: ["FUNCTIONS SHOULD DO ONE THING", "do one thing"],
  abstraction_level: ["One Level of Abstraction per Function", "Stepdown Rule"],
  naming: ["Avoid Disinformation", "answer all the big questions"],
  magic_number: ["Replace Magic Numbers with Named Constants", "Magic Numbers"],
  comments: ["Comments are always failures", "Redundant Comments"],
  class_responsibility: ["reason to change", "single reason to change"]
};

const OBSERVATION_CATEGORY_VALUES = [
  "function_design",
  "abstraction_level",
  "naming",
  "magic_number",
  "comments",
  "class_responsibility"
] as const;

const nullableStringSchema = z.string().min(1).nullish().transform((value) => value ?? undefined);
const nullableStringArraySchema = z.array(z.string()).nullish().transform((value) => value ?? []);

const llmFindingSchema = z.object({
  id: nullableStringSchema,
  observation_category: z.union([
    z.enum(OBSERVATION_CATEGORY_VALUES),
    z.array(z.enum(OBSERVATION_CATEGORY_VALUES)).nonempty()
  ]),
  title: z.string().min(1),
  summary: z.string().min(1),
  severity: z.enum(["high", "medium", "low"]),
  concept_id: nullableStringSchema,
  primary_code_anchor_ids: nullableStringArraySchema,
  primary_pdf_anchor_ids: nullableStringArraySchema,
  tags: nullableStringArraySchema
});

const llmCrossRefSchema = z.object({
  from_finding_id: z.string().min(1),
  to_finding_id: z.string().min(1),
  relation: z.string().min(1),
  score: z.coerce.number().min(0).max(1).default(0.75),
  reason: z.string().min(1)
});

const llmSynthesisResponseSchema = z.object({
  findings: z.array(llmFindingSchema).default([]),
  cross_refs: z.array(llmCrossRefSchema).default([])
});

function pdfAnchor(id: string, page: number, quote: string): MappingAnchor {
  return {
    id,
    document_id: "doc-clean-code-pdf",
    kind: "pdf_span",
    locator: {
      page,
      bbox: null,
      quote
    },
    deep_link: `Clean_Code.pdf#page=${page}&zoom=page-width`,
    quote,
    confidence: 0.9
  };
}

function buildCodeAnchor(
  id: string,
  fileName: string,
  start: number,
  end: number,
  symbolPath: string,
  quote: string
): MappingAnchor {
  return {
    id,
    document_id: "doc-submission",
    kind: "code_span",
    locator: {
      file_path: fileName,
      line_start: start,
      line_end: end,
      symbol_path: symbolPath
    },
    deep_link: `file:///${fileName.replaceAll("\\", "/")}#L${start}-L${end}`,
    quote,
    confidence: 1
  };
}

function slugify(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "item";
}

function clampUnitScore(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function uniqueList(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function extractJsonObject(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const objectMatch = trimmed.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    return objectMatch[0];
  }

  throw new Error("LLM response did not contain a JSON object");
}

function findLine(lines: string[], matcher: RegExp): number | null {
  const index = lines.findIndex((line) => matcher.test(line));
  return index >= 0 ? index + 1 : null;
}

export class SimpleJavaParserAdapter implements JavaParserPort {
  async parse(sourceCode: string): Promise<ParsedJavaFile> {
    const lines = sourceCode.split("\n");
    const methods: ParsedJavaFile["methods"] = [];
    const classMatch = sourceCode.match(/class\s+([A-Za-z0-9_]+)/);
    let currentMethod: { name: string; startLine: number; braceDepth: number; body: string[] } | null = null;

    lines.forEach((line, index) => {
      const trimmed = line.trim();
      const methodMatch = trimmed.match(
        /(?:public|protected|private)\s+(?:abstract\s+)?(?:static\s+)?[\w<>\[\]]+\s+([A-Za-z0-9_]+)\s*\([^)]*\)\s*(\{|;)/
      );

      if (!currentMethod && methodMatch) {
        const body = [line];
        if (methodMatch[2] === ";") {
          methods.push({
            name: methodMatch[1],
            startLine: index + 1,
            endLine: index + 1,
            body: body.join("\n")
          });
          return;
        }
        currentMethod = {
          name: methodMatch[1],
          startLine: index + 1,
          braceDepth: (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length,
          body
        };
        return;
      }

      if (currentMethod) {
        currentMethod.body.push(line);
        currentMethod.braceDepth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
        if (currentMethod.braceDepth === 0) {
          methods.push({
            name: currentMethod.name,
            startLine: currentMethod.startLine,
            endLine: index + 1,
            body: currentMethod.body.join("\n")
          });
          currentMethod = null;
        }
      }
    });

    return {
      className: classMatch?.[1] ?? null,
      lines,
      methods
    };
  }
}

export class HeuristicCodeObservationService implements CodeObservationService {
  private readonly deduper = new ObservationDeduper();

  async extractCodeAnchors(parsed: ParsedJavaFile, fileName: string): Promise<MappingAnchor[]> {
    const anchors: MappingAnchor[] = [];
    const byName = new Map(parsed.methods.map((method) => [method.name, method]));

    const completeMethod = byName.get("complete");
    if (completeMethod) {
      anchors.push(
        buildCodeAnchor(
          "anchor-code-complete-method",
          fileName,
          completeMethod.startLine,
          completeMethod.endLine,
          `${parsed.className ?? "Unknown"}.complete`,
          "beforeComplete -> completeTask -> createNextTaskInfo -> createNextTask -> afterCompleted"
        )
      );
    }

    const handlerMethod = byName.get("doHandler");
    if (handlerMethod) {
      anchors.push(
        buildCodeAnchor(
          "anchor-code-handler",
          fileName,
          handlerMethod.startLine,
          handlerMethod.endLine,
          `${parsed.className ?? "Unknown"}.doHandler`,
          "protected void doHandler(...) { // Default implementation }"
        )
      );
    }

    const createNextTask = byName.get("createNextTaskInfo");
    if (createNextTask) {
      anchors.push(
        buildCodeAnchor(
          "anchor-code-create-next-task",
          fileName,
          createNextTask.startLine,
          createNextTask.endLine,
          `${parsed.className ?? "Unknown"}.createNextTaskInfo`,
          "private ProjectTask createNextTaskInfo(ProcessRequest request)"
        )
      );
    }

    const roleLine = findLine(parsed.lines, /getTaskAssignRoleCode/);
    if (roleLine) {
      anchors.push(
        buildCodeAnchor(
          "anchor-code-role-code",
          fileName,
          roleLine,
          Math.min(roleLine + 4, parsed.lines.length),
          `${parsed.className ?? "Unknown"}.getTaskAssignRoleCode`,
          "getTaskAssignRoleCode(request) -> task.setProcessNodeCode(...)"
        )
      );
    }

    const statusLine = findLine(parsed.lines, /setStatus\s*\(\s*\d+\s*\)/);
    if (statusLine) {
      anchors.push(
        buildCodeAnchor(
          "anchor-code-magic-number",
          fileName,
          statusLine,
          statusLine,
          `${parsed.className ?? "Unknown"}.createNextTaskInfo`,
          parsed.lines[statusLine - 1].trim()
        )
      );
    }

    anchors.push(
      buildCodeAnchor(
        "anchor-code-class-scope",
        fileName,
        1,
        parsed.lines.length,
        parsed.className ?? basename(fileName),
        "class scope overview"
      )
    );

    return anchors;
  }

  async deriveObservations(input: {
    submission: Submission;
    parsed: ParsedJavaFile;
    anchors: MappingAnchor[];
  }): Promise<CodeObservation[]> {
    const observations: CodeObservation[] = [];
    const anchorsById = new Map(input.anchors.map((anchor) => [anchor.id, anchor]));
    const completeMethod = input.parsed.methods.find((method) => method.name === "complete");
    const allSource = input.submission.sourceCode;

    if (completeMethod && (completeMethod.body.match(/;/g) ?? []).length >= 4) {
      observations.push({
        observation_id: "obs-function-design",
        submission_id: input.submission.id,
        code_anchor_ids: ["anchor-code-complete-method"].filter((id) => anchorsById.has(id)),
        category: "function_design",
        summary: "方法同时承担多个动作，偏离单一职责。",
        confidence: 0.93
      });
    }

    if (
      completeMethod &&
      /new\s+[A-Za-z0-9_]+/.test(allSource) &&
      /projectTaskService\./.test(allSource)
    ) {
      observations.push({
        observation_id: "obs-abstraction-level",
        submission_id: input.submission.id,
        code_anchor_ids: ["anchor-code-complete-method"].filter((id) => anchorsById.has(id)),
        category: "abstraction_level",
        summary: "同一方法中同时存在高层编排与底层对象构造。",
        confidence: 0.9
      });
    }

    if (
      /doHandler/.test(allSource) ||
      /createNextTaskInfo/.test(allSource) ||
      /getTaskAssignRoleCode/.test(allSource)
    ) {
      observations.push({
        observation_id: "obs-naming",
        submission_id: input.submission.id,
        code_anchor_ids: [
          "anchor-code-handler",
          "anchor-code-role-code",
          "anchor-code-create-next-task"
        ].filter((id) => anchorsById.has(id)),
        category: "naming",
        summary: "命名不够表意且存在语义错位。",
        confidence: 0.91
      });
    }

    if (/setStatus\s*\(\s*\d+\s*\)/.test(allSource)) {
      observations.push({
        observation_id: "obs-magic-number",
        submission_id: input.submission.id,
        code_anchor_ids: ["anchor-code-magic-number"].filter((id) => anchorsById.has(id)),
        category: "magic_number",
        summary: "出现缺乏业务语义的魔法值。",
        confidence: 0.95
      });
    }

    if (/Default implementation/.test(allSource)) {
      observations.push({
        observation_id: "obs-comments",
        submission_id: input.submission.id,
        code_anchor_ids: ["anchor-code-handler"].filter((id) => anchorsById.has(id)),
        category: "comments",
        summary: "代码使用了冗余注释补充已显式表达的语义。",
        confidence: 0.89
      });
    }

    if (/abstract class/.test(allSource) && /private\s+[A-Za-z0-9_<>\[\]]+\s+create/.test(allSource)) {
      observations.push({
        observation_id: "obs-class-responsibility",
        submission_id: input.submission.id,
        code_anchor_ids: ["anchor-code-class-scope"].filter((id) => anchorsById.has(id)),
        category: "class_responsibility",
        summary: "类同时承担模板流程和对象构造等多个变化点。",
        confidence: 0.87
      });
    }

    return observations;
  }

  async deduplicateObservations(observations: CodeObservation[]): Promise<CodeObservation[]> {
    return this.deduper.execute(observations);
  }
}

export class StaticPdfCorpusRetrieverAdapter implements PdfCorpusRetrieverPort {
  async retrieve(input: {
    observations: CodeObservation[];
  }): Promise<RetrievedEvidenceCandidate[]> {
    return input.observations.flatMap((observation) => {
      const template = BOOK_EVIDENCE_BY_CATEGORY[observation.category];
      if (!template) {
        return [];
      }
      return [
        {
          observation_id: observation.observation_id,
          category: observation.category,
          anchors: template.anchors
        }
      ];
    });
  }
}

export class ExternalPdfReaderMcpClient implements PdfReaderMcpClientPort {
  private client: Client | null = null;

  private transport: StdioClientTransport | null = null;

  async searchPdf(input: {
    path: string;
    query: string;
    maxPages?: number;
    maxMatchesPerSource?: number;
    contextChars?: number;
  }): Promise<PdfReaderSearchResponse> {
    const client = await this.getClient();
    const response = await client.callTool({
      name: "search_pdf",
      arguments: {
        sources: [{ path: input.path }],
        query: input.query,
        max_pages: input.maxPages ?? 120,
        max_matches_per_source: input.maxMatchesPerSource ?? 8,
        context_chars: input.contextChars ?? 160
      }
    });

    const responseContent = Array.isArray((response as { content?: unknown }).content)
      ? ((response as { content: unknown[] }).content as unknown[])
      : [];

    const textContent = responseContent.find(
      (item): item is { type: "text"; text: string } =>
        typeof item === "object" &&
        item !== null &&
        "type" in item &&
        "text" in item &&
        (item as { type?: unknown }).type === "text" &&
        typeof (item as { text?: unknown }).text === "string"
    );

    if (!textContent) {
      return { results: [] };
    }

    try {
      return JSON.parse(textContent.text) as PdfReaderSearchResponse;
    } catch {
      return { results: [] };
    }
  }

  async close(): Promise<void> {
    this.client = null;
    if (this.transport) {
      await this.transport.close();
      this.transport = null;
    }
  }

  private async getClient(): Promise<Client> {
    if (this.client) {
      return this.client;
    }

    this.transport = new StdioClientTransport({
      command: "npx",
      args: ["-y", "@sylphx/pdf-reader-mcp"],
      stderr: "pipe"
    });

    const client = new Client({
      name: "mapping-mcp-retriever-client",
      version: "0.1.0"
    });
    await client.connect(this.transport);
    this.client = client;
    return client;
  }
}

export class McpPdfCorpusRetrieverAdapter implements PdfCorpusRetrieverPort {
  constructor(private readonly client: PdfReaderMcpClientPort) {}

  async retrieve(input: {
    corpus: { id: string; versionId: string; title: string; pdfPath: string; ready: boolean };
    observations: CodeObservation[];
  }): Promise<RetrievedEvidenceCandidate[]> {
    const candidates: RetrievedEvidenceCandidate[] = [];

    for (const observation of input.observations) {
      const queries = SEARCH_QUERY_BY_CATEGORY[observation.category] ?? [];
      const anchors: MappingAnchor[] = [];

      for (const query of queries) {
        const response = await this.client.searchPdf({
          path: input.corpus.pdfPath,
          query
        });
        const parsedAnchors = this.mapResponseToAnchors(response);
        parsedAnchors.forEach((anchor) => {
          if (!anchors.some((item) => item.id === anchor.id)) {
            anchors.push(anchor);
          }
        });
        if (anchors.length) {
          break;
        }
      }

      if (anchors.length) {
        candidates.push({
          observation_id: observation.observation_id,
          category: observation.category,
          anchors
        });
      }
    }

    return candidates;
  }

  private mapResponseToAnchors(response: PdfReaderSearchResponse): MappingAnchor[] {
    return (response.results ?? [])
      .filter((result) => result.success)
      .flatMap((result) =>
        (result.matches ?? [])
          .filter((match) => typeof match.page === "number" && Boolean(match.snippet || match.text))
          .map((match) => {
            const text = match.snippet ?? match.text ?? "";
            return {
              id: `anchor-pdf-p${match.page}-${(match.id ?? text).replace(/[^a-zA-Z0-9_-]+/g, "-")}`,
              document_id: "doc-clean-code-pdf",
              kind: "pdf_span" as const,
              locator: {
                page: match.page,
                bbox: match.bounding_box
                  ? [
                      match.bounding_box.left,
                      match.bounding_box.bottom,
                      match.bounding_box.right,
                      match.bounding_box.top
                    ]
                  : null,
                quote: text
              },
              deep_link: `Clean_Code.pdf#page=${match.page}&zoom=page-width`,
              quote: text,
              confidence: 0.9
            };
          })
      );
  }
}

export class HybridPdfCorpusRetrieverAdapter implements PdfCorpusRetrieverPort {
  constructor(
    private readonly primary: PdfCorpusRetrieverPort,
    private readonly fallback: PdfCorpusRetrieverPort
  ) {}

  async retrieve(input: {
    corpus: { id: string; versionId: string; title: string; pdfPath: string; ready: boolean };
    observations: CodeObservation[];
  }): Promise<RetrievedEvidenceCandidate[]> {
    const primaryResult = await this.primary.retrieve(input);
    return primaryResult.length ? primaryResult : this.fallback.retrieve(input);
  }
}

export function hasLocalPdf(path: string): boolean {
  try {
    accessSync(path, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export class ExternalDeepSeekChatClient implements LlmChatClientPort {
  constructor(
    private readonly config: DeepSeekLlmConfig,
    private readonly fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)
  ) {}

  async completeJson(input: { messages: LlmChatMessage[]; temperature?: number }): Promise<string> {
    const url = this.config.baseUrl.replace(/\/$/, "").endsWith("/chat/completions")
      ? this.config.baseUrl.replace(/\/$/, "")
      : `${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`;
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: input.messages,
        temperature: input.temperature ?? 0.1,
        response_format: {
          type: "json_object"
        }
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`DeepSeek synthesis request failed: ${response.status} ${body}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string | null;
        };
      }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("DeepSeek synthesis response did not contain message content");
    }

    return content;
  }

  async close(): Promise<void> {
    return Promise.resolve();
  }
}

function buildDocuments(input: SynthesisInput): MappingSchema["documents"] {
  return [
    {
      id: "doc-clean-code-pdf",
      kind: "pdf",
      title: "Clean Code",
      path: "Clean_Code.pdf",
      page_count: 462
    },
    {
      id: "doc-submission",
      kind: "code",
      title: input.fileName,
      path: input.fileName,
      language: "java",
      content: input.sourceCode
    }
  ];
}

function buildBookCoverage(
  concepts: MappingConcept[],
  findings: MappingFinding[],
  evidenceLinks: MappingEvidenceLink[],
  anchors: MappingAnchor[]
): MappingSchema["ui_indexes"]["book_coverage"] {
  const evidenceById = new Map(evidenceLinks.map((item) => [item.id, item]));
  return concepts.map((concept) => {
    const pages = findings
      .filter((finding) => finding.concept_ids.includes(concept.id))
      .flatMap((finding) => finding.representative_evidence_ids)
      .map((evidenceId) => evidenceById.get(evidenceId))
      .filter((item): item is MappingEvidenceLink => item !== undefined && item.relation === "supported_by_book")
      .map((item) => anchors.find((anchor) => anchor.id === item.anchor_id))
      .filter((anchor): anchor is MappingAnchor => Boolean(anchor))
      .map((anchor) => anchor.locator.page ?? 0)
      .filter((page) => page > 0);
    const uniquePages = [...new Set(pages)];
    return {
      concept_id: concept.id,
      matched_pages: uniquePages,
      match_count: uniquePages.length
    };
  });
}

function buildSchema(input: {
  synthesisInput: SynthesisInput;
  anchors: MappingAnchor[];
  concepts: MappingConcept[];
  findings: MappingFinding[];
  evidenceLinks: MappingEvidenceLink[];
  crossRefs: MappingCrossRef[];
}): MappingSchema {
  const { synthesisInput, anchors, concepts, findings, evidenceLinks, crossRefs } = input;
  return {
    schema_version: "1.0.0",
    task: {
      id: `task-${synthesisInput.submissionId}`,
      goal: "从单个 Java 文件映射到固定教材中的精准溯源结果",
      created_at: new Date().toISOString(),
      language: "zh-CN"
    },
    documents: buildDocuments(synthesisInput),
    anchors,
    concepts,
    findings,
    evidence_links: evidenceLinks,
    cross_refs: crossRefs,
    ui_indexes: {
      default_finding_order: findings.map((item) => item.id),
      finding_groups: buildFindingGroups(findings),
      book_coverage: buildBookCoverage(concepts, findings, evidenceLinks, anchors),
      default_selected: findings.length
        ? {
            finding_id: findings[0].id,
            evidence_id: findings[0].representative_evidence_ids[0] ?? ""
          }
        : {
            finding_id: "",
            evidence_id: ""
          },
      hero: {
        title: "精准溯源与交叉引用 Demo",
        description: "MCP mapping server 生成的结构化结果，可直接交给 viewer 渲染。",
        pills: [
          `代码：${synthesisInput.fileName}`,
          "教材：Clean_Code.pdf",
          `状态：${findings.length ? "有命中" : "无命中"}`
        ]
      },
      summary: {
        title: "结论摘要",
        text: findings.length
          ? `本次映射共生成 ${findings.length} 条 finding，均来自代码观察、教材证据与 LLM synthesis。`
          : "本次映射没有找到足够的教材证据，因此返回 partial 结果。"
      }
    }
  };
}

function buildSynthesisMessages(input: {
  model: string;
  observations: CodeObservation[];
  evidenceCandidates: RetrievedEvidenceCandidate[];
  codeAnchors: MappingAnchor[];
  concepts: MappingConcept[];
}): LlmChatMessage[] {
  const promptPayload = {
    model: input.model,
    instructions: {
      role: "你是一个代码审查与教材对齐助手。",
      goal: "根据代码观察与教材证据，输出高质量 findings，并选择最合适的主代码锚点和主 PDF 锚点。",
      constraints: [
        "只输出 JSON，不要输出 Markdown。",
        "只能引用输入中提供的 observation_category、concept_id、anchor_id。",
        "不要编造不存在的页码、锚点或概念。",
        "优先使用正文强证据，避免目录页和索引页作为 primary_pdf_anchor_ids。",
        "finding summary 要简洁、可读，适合直接在 UI 中展示。"
      ],
      output_contract: {
        findings: [
          {
            id: "string, optional",
            observation_category: OBSERVATION_CATEGORY_VALUES,
            title: "string",
            summary: "string",
            severity: "high | medium | low",
            concept_id: "string, optional",
            primary_code_anchor_ids: ["string"],
            primary_pdf_anchor_ids: ["string"],
            tags: ["string"]
          }
        ],
        cross_refs: [
          {
            from_finding_id: "string",
            to_finding_id: "string",
            relation: "string",
            score: "0..1",
            reason: "string"
          }
        ]
      }
    },
    concepts: input.concepts,
    observations: input.observations.map((item) => ({
      observation_id: item.observation_id,
      category: item.category,
      summary: item.summary,
      confidence: item.confidence,
      code_anchor_ids: item.code_anchor_ids
    })),
    code_anchors: input.codeAnchors.map((item) => ({
      id: item.id,
      quote: item.quote,
      locator: item.locator
    })),
    evidence_candidates: input.evidenceCandidates.map((item) => ({
      observation_id: item.observation_id,
      category: item.category,
      anchors: item.anchors.map((anchor) => ({
        id: anchor.id,
        page: anchor.locator.page ?? null,
        quote: anchor.quote,
        bbox: anchor.locator.bbox ?? null
      }))
    }))
  };

  return [
    {
      role: "system",
      content:
        "你负责把代码观察与教材证据综合成结构化 mapping finding。输出必须是严格 JSON，对应用户提供的 output_contract。"
    },
    {
      role: "user",
      content: JSON.stringify(promptPayload, null, 2)
    }
  ];
}

export class DeepSeekLlmSynthesisAdapter implements LlmSynthesisPort {
  constructor(
    private readonly client: LlmChatClientPort,
    private readonly config: Pick<DeepSeekLlmConfig, "model">
  ) {}

  async synthesize(input: SynthesisInput): Promise<SynthesisOutput> {
    const evidenceByCategory = new Map(input.evidenceCandidates.map((item) => [item.category, item.anchors]));
    const concepts = new Map<string, MappingConcept>();
    const anchors = [...input.codeAnchors];

    for (const candidate of input.evidenceCandidates) {
      candidate.anchors.forEach((anchor) => {
        if (!anchors.some((item) => item.id === anchor.id)) {
          anchors.push(anchor);
        }
      });
      const template = BOOK_EVIDENCE_BY_CATEGORY[candidate.category];
      if (template) {
        concepts.set(template.concept.id, template.concept);
      }
    }

    if (!input.evidenceCandidates.length) {
      return {
        schema: buildSchema({
          synthesisInput: input,
          anchors,
          concepts: Array.from(concepts.values()),
          findings: [],
          evidenceLinks: [],
          crossRefs: []
        }),
        status: "partial"
      };
    }

    const raw = await this.client.completeJson({
      messages: buildSynthesisMessages({
        model: this.config.model,
        observations: input.observations,
        evidenceCandidates: input.evidenceCandidates,
        codeAnchors: input.codeAnchors,
        concepts: Array.from(concepts.values())
      }),
      temperature: 0.1
    });
    const parsed = llmSynthesisResponseSchema.parse(JSON.parse(extractJsonObject(raw)));
    const findings: MappingFinding[] = [];
    const evidenceLinks: MappingEvidenceLink[] = [];
    const crossRefs: MappingCrossRef[] = [];
    const findingIds = new Set<string>();
    const codeAnchorById = new Map(input.codeAnchors.map((anchor) => [anchor.id, anchor]));

    parsed.findings.forEach((candidate, index) => {
      const observationCategories = Array.isArray(candidate.observation_category)
        ? candidate.observation_category
        : [candidate.observation_category];
      const observation = input.observations.find((item) => observationCategories.includes(item.category));
      if (!observation) {
        return;
      }

      const template = BOOK_EVIDENCE_BY_CATEGORY[observation.category];
      if (template) {
        concepts.set(template.concept.id, template.concept);
      }

      const availableCodeAnchorIds = observation.code_anchor_ids.filter((id) => codeAnchorById.has(id));
      const availablePdfAnchors = evidenceByCategory.get(observation.category) ?? [];
      const preferredCodeAnchorIds = candidate.primary_code_anchor_ids.filter((id) =>
        availableCodeAnchorIds.includes(id)
      );
      const preferredPdfAnchorIds = candidate.primary_pdf_anchor_ids.filter((id) =>
        availablePdfAnchors.some((anchor) => anchor.id === id)
      );
      const conceptId = candidate.concept_id && concepts.has(candidate.concept_id)
        ? candidate.concept_id
        : template?.concept.id ?? "";
      const findingIdBase = candidate.id && !findingIds.has(candidate.id)
        ? candidate.id
        : `finding-${slugify(candidate.title)}-${index + 1}`;
      const findingId = findingIds.has(findingIdBase) ? `${findingIdBase}-${index + 1}` : findingIdBase;
      findingIds.add(findingId);

      const finding: MappingFinding = {
        id: findingId,
        title: candidate.title,
        summary: candidate.summary,
        severity: candidate.severity,
        confidence: clampUnitScore(observation.confidence),
        concept_ids: conceptId ? [conceptId] : [],
        primary_code_anchor_ids: preferredCodeAnchorIds.length
          ? preferredCodeAnchorIds
          : availableCodeAnchorIds.slice(0, 1),
        primary_pdf_anchor_ids: preferredPdfAnchorIds.length
          ? preferredPdfAnchorIds
          : availablePdfAnchors.slice(0, 1).map((anchor) => anchor.id),
        tags: uniqueList(candidate.tags).slice(0, 6),
        representative_evidence_ids: []
      };

      availableCodeAnchorIds.forEach((anchorId, codeIndex) => {
        const evidenceId = `ev-${finding.id}-code-${codeIndex + 1}`;
        if (codeIndex === 0) {
          finding.representative_evidence_ids.push(evidenceId);
        }
        evidenceLinks.push({
          id: evidenceId,
          finding_id: finding.id,
          anchor_id: anchorId,
          relation: "observed_in_code",
          score: clampUnitScore(observation.confidence),
          importance_score: clampUnitScore(observation.confidence),
          novelty_score: 0.7,
          representative: codeIndex === 0,
          rationale: observation.summary
        });
      });

      availablePdfAnchors.forEach((anchor, pdfIndex) => {
        const evidenceId = `ev-${finding.id}-pdf-${pdfIndex + 1}`;
        if (pdfIndex === 0) {
          finding.representative_evidence_ids.push(evidenceId);
        }
        evidenceLinks.push({
          id: evidenceId,
          finding_id: finding.id,
          anchor_id: anchor.id,
          relation: "supported_by_book",
          score: clampUnitScore(Math.max(0.82, observation.confidence - 0.03)),
          importance_score: clampUnitScore(Math.max(0.8, observation.confidence - 0.03)),
          novelty_score: 0.72,
          representative: pdfIndex === 0,
          rationale: `教材片段支持“${candidate.title}”这条判断。`
        });
      });

      findings.push(finding);
    });

    parsed.cross_refs.forEach((item, index) => {
      if (!findingIds.has(item.from_finding_id) || !findingIds.has(item.to_finding_id)) {
        return;
      }
      if (item.from_finding_id === item.to_finding_id) {
        return;
      }
      crossRefs.push({
        id: `xref-${slugify(item.from_finding_id)}-${slugify(item.to_finding_id)}-${index + 1}`,
        from_type: "finding",
        from_id: item.from_finding_id,
        to_type: "finding",
        to_id: item.to_finding_id,
        relation: item.relation,
        score: clampUnitScore(item.score),
        reason: item.reason
      });
    });

    return {
      schema: buildSchema({
        synthesisInput: input,
        anchors,
        concepts: Array.from(concepts.values()),
        findings,
        evidenceLinks,
        crossRefs
      }),
      status: findings.length ? "completed" : "partial"
    };
  }
}

function buildFindingGroups(findings: MappingFinding[]): MappingSchema["ui_indexes"]["finding_groups"] {
  const byTitle = new Map<string, string[]>();
  const push = (title: string, findingId: string): void => {
    const list = byTitle.get(title) ?? [];
    list.push(findingId);
    byTitle.set(title, list);
  };

  findings.forEach((finding) => {
    if (finding.concept_ids.includes("concept-function-design")) {
      push("函数设计", finding.id);
    } else if (finding.concept_ids.includes("concept-class-responsibility")) {
      push("类设计", finding.id);
    } else {
      push("命名与可读性", finding.id);
    }
  });

  return Array.from(byTitle.entries()).map(([title, findingIds], index) => ({
    id: `group-${index + 1}`,
    title,
    finding_ids: findingIds
  }));
}

export class BasicMappingSchemaValidatorAdapter implements MappingSchemaValidatorPort {
  private readonly validator = new BasicSchemaValidationService();

  async validate(result: MappingSchema) {
    return this.validator.execute(result);
  }
}
