import { z } from "zod";

import type { Application } from "../bootstrap/createApplication.js";
import { DomainError } from "../domain/errors.js";

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

function normalizeError(error: unknown): Error & { code?: string } {
  if (error instanceof DomainError) {
    return error;
  }
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
}

export function createMappingMcpService(application: Application) {
  return {
    async mappingCreateJob(input: unknown) {
      const payload = createJobSchema.parse(input);
      return application.createMappingJob.execute(payload);
    },

    async mappingGetJob(input: unknown) {
      const payload = jobIdSchema.parse(input);
      return application.getMappingJob.execute({ jobId: payload.job_id });
    },

    async mappingGetResult(input: unknown) {
      const payload = jobIdSchema.parse(input);
      return application.getMappingResult.execute({ jobId: payload.job_id });
    },

    formatToolError(error: unknown) {
      const normalized = normalizeError(error);
      return {
        code: normalized.code ?? "UNEXPECTED_ERROR",
        message: normalized.message
      };
    }
  };
}
