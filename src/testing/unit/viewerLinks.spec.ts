import { describe, expect, it } from "vitest";

import {
  buildDemoViewerUrl,
  buildHostHints,
  buildJobLinks,
  buildJobUrl,
  buildResultUrl,
  buildViewerUrl,
  resolveNextAction
} from "../../host/viewerLinks.js";

describe("viewer links", () => {
  const baseUrl = "http://127.0.0.1:8765/";
  const jobId = "job_123";

  it("builds stable viewer, job, and result URLs", () => {
    expect(buildViewerUrl(baseUrl, jobId)).toBe(
      "http://127.0.0.1:8765/cross-validation.html?jobId=job_123"
    );
    expect(buildJobUrl(baseUrl, jobId)).toBe("http://127.0.0.1:8765/api/mapping/jobs/job_123");
    expect(buildResultUrl(baseUrl, jobId)).toBe(
      "http://127.0.0.1:8765/api/mapping/jobs/job_123/result"
    );
    expect(buildDemoViewerUrl(baseUrl)).toBe("http://127.0.0.1:8765/cross-validation.html?demo=1");
  });

  it("exposes host links for viewer, job, result, and demo", () => {
    const links = buildJobLinks(baseUrl, jobId);

    expect(links.map((item) => item.rel)).toEqual(["viewer", "job", "result", "demo"]);
    expect(links.every((item) => item.method === "GET")).toBe(true);
  });

  it("maps job status to next actions", () => {
    expect(resolveNextAction("queued")).toBe("poll_job");
    expect(resolveNextAction("running")).toBe("poll_job");
    expect(resolveNextAction("completed")).toBe("open_viewer");
    expect(resolveNextAction("partial")).toBe("open_viewer");
    expect(resolveNextAction("failed")).toBe("fix_input");
  });

  it("builds host hints with viewer url and polling metadata", () => {
    const hints = buildHostHints({
      baseUrl,
      jobId,
      status: "queued",
      pollIntervalMs: 1500
    });

    expect(hints.viewer_url).toBe("http://127.0.0.1:8765/cross-validation.html?jobId=job_123");
    expect(hints.next_action).toBe("poll_job");
    expect(hints.recommended_poll_interval_ms).toBe(1500);
    expect(hints.links).toHaveLength(4);
  });
});
