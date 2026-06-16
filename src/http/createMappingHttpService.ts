import { z } from "zod";

import type { Application } from "../bootstrap/createApplication.js";
import { DomainError } from "../domain/errors.js";
import { buildHostHints, type HostHints } from "../host/viewerLinks.js";

const createJobSchema = z.object({
  file_name: z.string().min(1),
  language: z.literal("java"),
  source_code: z.string().min(1),
  corpus_id: z.string().optional(),
  mapping_profile_id: z.string().optional(),
  model_profile_id: z.string().optional()
});

const jobIdSchema = z.object({
  job_id: z.string().min(1)
});

export interface HttpJobEnvelope<TJob> extends HostHints {
  job: TJob;
}

function normalizeError(error: unknown): Error & { code?: string } {
  if (error instanceof DomainError) {
    return error;
  }
  if (error instanceof z.ZodError) {
    return Object.assign(new Error(error.issues.map((issue) => issue.message).join("; ")), {
      code: "INVALID_REQUEST"
    });
  }
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
}

function mapErrorToStatusCode(code: string): number {
  switch (code) {
    case "INVALID_REQUEST":
      return 400;
    case "JOB_NOT_FOUND":
    case "RESULT_NOT_READY":
    case "CORPUS_NOT_FOUND":
      return 404;
    case "CORPUS_NOT_READY":
    case "SCHEMA_VALIDATION_FAILED":
      return 409;
    default:
      return 500;
  }
}

export function createMappingHttpService(application: Application, gatewayBaseUrl: string) {
  return {
    async mappingCreateJob(input: unknown) {
      const payload = createJobSchema.parse(input);
      const job = await application.createMappingJob.execute(payload);
      return {
        job,
        ...buildHostHints({
          baseUrl: gatewayBaseUrl,
          jobId: job.job_id,
          status: job.status
        })
      } satisfies HttpJobEnvelope<typeof job>;
    },

    async mappingGetJob(input: unknown) {
      const payload = jobIdSchema.parse(input);
      const job = await application.getMappingJob.execute({ jobId: payload.job_id });
      return {
        job,
        ...buildHostHints({
          baseUrl: gatewayBaseUrl,
          jobId: job.job_id,
          status: job.status
        })
      } satisfies HttpJobEnvelope<typeof job>;
    },

    async mappingGetResult(input: unknown) {
      const payload = jobIdSchema.parse(input);
      return application.getMappingResult.execute({ jobId: payload.job_id });
    },

    health() {
      return {
        status: "ok" as const,
        gateway_base_url: gatewayBaseUrl
      };
    },

    formatHttpError(error: unknown) {
      const normalized = normalizeError(error);
      const code = normalized.code ?? "UNEXPECTED_ERROR";
      return {
        code,
        message: normalized.message,
        statusCode: mapErrorToStatusCode(code)
      };
    }
  };
}
