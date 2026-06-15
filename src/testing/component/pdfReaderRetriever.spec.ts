import { describe, expect, it } from "vitest";

import type { CodeObservation } from "../../contracts/types.js";
import { McpPdfCorpusRetrieverAdapter } from "../../infrastructure/adapters.js";

class FakePdfReaderMcpClient {
  constructor(private readonly response: unknown) {}

  async searchPdf(): Promise<{ results?: Array<{ success?: boolean; matches?: Array<Record<string, unknown>> }> }> {
    return this.response as { results?: Array<{ success?: boolean; matches?: Array<Record<string, unknown>> }> };
  }

  async close(): Promise<void> {}
}

describe("pdf-reader retriever adapter", () => {
  it("converts search_pdf matches into pdf evidence anchors", async () => {
    const adapter = new McpPdfCorpusRetrieverAdapter(
      new FakePdfReaderMcpClient({
        results: [
          {
            source: "d:\\ml\\ppt-vibe\\tk-personal-growth\\Clean_Code.pdf",
            success: true,
            matches: [
              {
                id: "p66-match-1",
                page: 66,
                text: "FUNCTIONS SHOULD DO ONE THING. THEY SHOULD DO IT WELL.",
                snippet: "FUNCTIONS SHOULD DO ONE THING. THEY SHOULD DO IT WELL.",
                bounding_box: {
                  left: 1,
                  bottom: 2,
                  right: 3,
                  top: 4
                }
              }
            ]
          }
        ]
      })
    );

    const observations: CodeObservation[] = [
      {
        observation_id: "obs-1",
        submission_id: "sub-1",
        code_anchor_ids: ["anchor-code-complete-method"],
        category: "function_design",
        summary: "职责过多",
        confidence: 0.93
      }
    ];

    const candidates = await adapter.retrieve({
      corpus: {
        id: "clean-code",
        versionId: "clean-code@1",
        title: "Clean Code",
        pdfPath: "d:\\ml\\ppt-vibe\\tk-personal-growth\\Clean_Code.pdf",
        ready: true
      },
      observations
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0].anchors[0].locator.page).toBe(66);
    expect(candidates[0].anchors[0].kind).toBe("pdf_span");
  });

  it("returns empty candidates when search response is malformed or empty", async () => {
    const adapter = new McpPdfCorpusRetrieverAdapter(new FakePdfReaderMcpClient({ results: [] }));

    const candidates = await adapter.retrieve({
      corpus: {
        id: "clean-code",
        versionId: "clean-code@1",
        title: "Clean Code",
        pdfPath: "d:\\ml\\ppt-vibe\\tk-personal-growth\\Clean_Code.pdf",
        ready: true
      },
      observations: [
        {
          observation_id: "obs-1",
          submission_id: "sub-1",
          code_anchor_ids: ["anchor-code-complete-method"],
          category: "function_design",
          summary: "职责过多",
          confidence: 0.93
        }
      ]
    });

    expect(candidates).toEqual([]);
  });
});
