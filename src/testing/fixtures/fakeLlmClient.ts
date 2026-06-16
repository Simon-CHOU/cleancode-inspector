import type { LlmChatClientPort, LlmChatMessage } from "../../infrastructure/adapters.js";

export class FakeLlmClient implements LlmChatClientPort {
  private readonly queuedResponses: string[];

  constructor(
    responseText: string | string[],
    private readonly onCall?: (messages: LlmChatMessage[]) => void
  ) {
    this.queuedResponses = Array.isArray(responseText) ? [...responseText] : [responseText];
  }

  closed = false;

  async completeJson(input: { messages: LlmChatMessage[] }): Promise<string> {
    this.onCall?.(input.messages);
    const next = this.queuedResponses.shift();
    if (!next) {
      throw new Error("FakeLlmClient ran out of queued responses");
    }
    return next;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

export function createAbstractTaskEngineLlmResponse(): string {
  return JSON.stringify({
    findings: [
      {
        id: "finding-complete-too-much",
        observation_category: ["function_design"],
        title: "方法职责过多",
        summary: "该方法同时做前置钩子、状态推进、下一任务构造与持久化，偏离单一职责。",
        severity: "high",
        concept_id: "concept-function-design",
        primary_code_anchor_ids: ["anchor-code-complete-method"],
        primary_pdf_anchor_ids: ["anchor-pdf-p66-p66-match-2"],
        tags: ["职责过多", "流程编排"]
      },
      {
        id: "finding-mixed-abstraction-level",
        observation_category: ["abstraction_level"],
        title: "同一方法混杂多层抽象",
        summary: "方法里既有高层编排，又有对象构造和 service 调用，抽象层级不统一。",
        severity: "high",
        concept_id: "concept-function-design",
        primary_code_anchor_ids: ["anchor-code-complete-method"],
        primary_pdf_anchor_ids: ["anchor-pdf-p67"],
        tags: ["抽象层次", "stepdown"]
      }
    ],
    cross_refs: [
      {
        from_finding_id: "finding-complete-too-much",
        to_finding_id: "finding-mixed-abstraction-level",
        relation: "closely_related",
        score: 0.91,
        reason: "职责过多通常伴随抽象层级混杂。"
      }
    ]
  });
}
