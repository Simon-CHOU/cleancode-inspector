import type { JobStatus } from "../contracts/types.js";

export const DEFAULT_POLL_INTERVAL_MS = 1000;

export type HostNextAction = "poll_job" | "fetch_result" | "open_viewer" | "fix_input";

export interface HostLink {
  rel: "viewer" | "job" | "result" | "demo";
  href: string;
  method: "GET";
}

export interface HostHints {
  viewer_url: string;
  links: HostLink[];
  recommended_poll_interval_ms: number;
  next_action: HostNextAction;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

export function buildViewerUrl(baseUrl: string, jobId: string): string {
  return `${normalizeBaseUrl(baseUrl)}/cross-validation.html?jobId=${encodeURIComponent(jobId)}`;
}

export function buildDemoViewerUrl(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/cross-validation.html?demo=1`;
}

export function buildJobUrl(baseUrl: string, jobId: string): string {
  return `${normalizeBaseUrl(baseUrl)}/api/mapping/jobs/${encodeURIComponent(jobId)}`;
}

export function buildResultUrl(baseUrl: string, jobId: string): string {
  return `${normalizeBaseUrl(baseUrl)}/api/mapping/jobs/${encodeURIComponent(jobId)}/result`;
}

export function buildJobLinks(baseUrl: string, jobId: string): HostLink[] {
  return [
    {
      rel: "viewer",
      href: buildViewerUrl(baseUrl, jobId),
      method: "GET"
    },
    {
      rel: "job",
      href: buildJobUrl(baseUrl, jobId),
      method: "GET"
    },
    {
      rel: "result",
      href: buildResultUrl(baseUrl, jobId),
      method: "GET"
    },
    {
      rel: "demo",
      href: buildDemoViewerUrl(baseUrl),
      method: "GET"
    }
  ];
}

export function resolveNextAction(status: JobStatus): HostNextAction {
  switch (status) {
    case "queued":
    case "running":
      return "poll_job";
    case "completed":
    case "partial":
      return "open_viewer";
    case "failed":
      return "fix_input";
    default:
      return "poll_job";
  }
}

export function buildHostHints(input: {
  baseUrl: string;
  jobId: string;
  status: JobStatus;
  pollIntervalMs?: number;
}): HostHints {
  return {
    viewer_url: buildViewerUrl(input.baseUrl, input.jobId),
    links: buildJobLinks(input.baseUrl, input.jobId),
    recommended_poll_interval_ms: input.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    next_action: resolveNextAction(input.status)
  };
}
