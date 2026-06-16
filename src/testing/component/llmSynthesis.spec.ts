import { describe, expect, it } from "vitest";

import type { CodeObservation, MappingAnchor, RetrievedEvidenceCandidate } from "../../contracts/types.js";
import { DeepSeekLlmSynthesisAdapter } from "../../infrastructure/adapters.js";
import { createAbstractTaskEngineLlmResponse, FakeLlmClient } from "../fixtures/fakeLlmClient.js";

const codeAnchors: MappingAnchor[] = [
  {
    id: "anchor-code-complete-method",
    document_id: "doc-submission",
    kind: "code_span",
    locator: {
      file_path: "AbstractTaskEngine.java",
      line_start: 20,
      line_end: 25,
      symbol_path: "AbstractTaskEngine.complete"
    },
    deep_link: "file:///AbstractTaskEngine.java#L20-L25",
    quote: "beforeComplete -> completeTask -> createNextTaskInfo -> createNextTask -> afterCompleted",
    confidence: 1
  }
];

const evidenceCandidates: RetrievedEvidenceCandidate[] = [
  {
    observation_id: "obs-function-design",
    category: "function_design",
    anchors: [
      {
        id: "anchor-pdf-p66-p66-match-2",
        document_id: "doc-clean-code-pdf",
        kind: "pdf_span",
        locator: {
          page: 66,
          bbox: [115.92, 172.445, 400.965, 183.445],
          quote: "FUNCTIONS SHOULD DO ONE THING. THEY SHOULD DO IT WELL."
        },
        deep_link: "Clean_Code.pdf#page=66",
        quote: "FUNCTIONS SHOULD DO ONE THING. THEY SHOULD DO IT WELL.",
        confidence: 0.9
      }
    ]
  }
];

const observations: CodeObservation[] = [
  {
    observation_id: "obs-function-design",
    submission_id: "sub_1",
    code_anchor_ids: ["anchor-code-complete-method"],
    category: "function_design",
    summary: "方法同时承担多个动作，偏离单一职责。",
    confidence: 0.93
  }
];

describe("DeepSeekLlmSynthesisAdapter", () => {
  it("builds schema from LLM-authored findings and actual evidence anchors", async () => {
    const adapter = new DeepSeekLlmSynthesisAdapter(
      new FakeLlmClient(createAbstractTaskEngineLlmResponse()),
      { model: "deepseek-v4-flash" }
    );

    const result = await adapter.synthesize({
      submissionId: "sub_1",
      fileName: "AbstractTaskEngine.java",
      sourceCode: "class AbstractTaskEngine {}",
      observations,
      codeAnchors,
      evidenceCandidates,
      corpusId: "clean-code",
      corpusVersionId: "v1",
      mappingProfileId: "default",
      modelProfileId: "deepseek"
    });

    expect(result.status).toBe("completed");
    expect(result.schema.findings).toHaveLength(1);
    expect(result.schema.findings[0]?.primary_pdf_anchor_ids).toEqual(["anchor-pdf-p66-p66-match-2"]);
    expect(result.schema.evidence_links.some((item) => item.anchor_id === "anchor-pdf-p66-p66-match-2")).toBe(true);
  });

  it("repairs invalid JSON from the first LLM response and retries once", async () => {
    const invalidJson = `{
  "findings": [
    {
      "id": "finding-complete-too-much",
      "observation_category": ["function_design"],
      "title": "方法职责过多",
      "summary": "该方法同时做前置钩子、状态推进与 "下一任务" 构造",
      "severity": "high",
      "concept_id": "concept-function-design",
      "primary_code_anchor_ids": ["anchor-code-complete-method"],
      "primary_pdf_anchor_ids": ["anchor-pdf-p66-p66-match-2"],
      "tags": ["职责过多", "流程编排"]
    }
  ],
  "cross_refs": []
}`;

    const adapter = new DeepSeekLlmSynthesisAdapter(
      new FakeLlmClient([invalidJson, createAbstractTaskEngineLlmResponse()]),
      { model: "deepseek-v4-flash" }
    );

    const result = await adapter.synthesize({
      submissionId: "sub_1",
      fileName: "AbstractTaskEngine.java",
      sourceCode: "class AbstractTaskEngine {}",
      observations,
      codeAnchors,
      evidenceCandidates,
      corpusId: "clean-code",
      corpusVersionId: "v1",
      mappingProfileId: "default",
      modelProfileId: "deepseek"
    });

    expect(result.status).toBe("completed");
    expect(result.schema.findings[0]?.title).toBe("方法职责过多");
    expect(result.schema.evidence_links.some((item) => item.anchor_id === "anchor-pdf-p66-p66-match-2")).toBe(true);
  });
});
