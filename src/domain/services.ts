import type { CodeObservation, MappingSchema, ValidationResult } from "../contracts/types.js";

export class ObservationDeduper {
  async execute(observations: CodeObservation[]): Promise<CodeObservation[]> {
    const seen = new Set<string>();
    return observations.filter((observation) => {
      const key = `${observation.category}:${observation.code_anchor_ids.join(",")}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }
}

export class BasicSchemaValidationService {
  async execute(result: MappingSchema): Promise<ValidationResult> {
    const issues: string[] = [];

    if (!result.documents.length) {
      issues.push("documents must not be empty");
    }
    if (!result.anchors.length) {
      issues.push("anchors must not be empty");
    }

    const evidenceByFinding = new Map<string, string[]>();
    result.evidence_links.forEach((evidence) => {
      const entry = evidenceByFinding.get(evidence.finding_id) ?? [];
      entry.push(evidence.anchor_id);
      evidenceByFinding.set(evidence.finding_id, entry);
    });

    result.findings.forEach((finding) => {
      const evidenceIds = evidenceByFinding.get(finding.id) ?? [];
      if (!evidenceIds.length) {
        issues.push(`finding ${finding.id} has no evidence`);
      }
      if (!finding.primary_code_anchor_ids.length) {
        issues.push(`finding ${finding.id} has no primary code anchor`);
      }
    });

    return {
      valid: issues.length === 0,
      issues
    };
  }
}
