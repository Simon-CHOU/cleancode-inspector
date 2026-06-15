import { describe, expect, it } from "vitest";

import { DomainError } from "../../domain/errors.js";
import { MappingJob, Submission } from "../../domain/model.js";

describe("domain rules", () => {
  it("accepts only single java source file submissions", () => {
    expect(() =>
      Submission.create({
        fileName: "demo.txt",
        language: "java",
        sourceCode: "class A {}"
      })
    ).toThrowError(DomainError);

    const submission = Submission.create({
      fileName: "Demo.java",
      language: "java",
      sourceCode: "class Demo {}"
    });

    expect(submission.fileName).toBe("Demo.java");
    expect(submission.language).toBe("java");
  });

  it("enforces mapping job terminal state transitions", () => {
    const job = MappingJob.create({
      submissionId: "sub-1",
      corpusId: "clean-code",
      corpusVersionId: "clean-code@1"
    });

    job.start();
    job.advanceTo("parse", 25);
    job.complete("result-1", "completed");

    expect(job.status).toBe("completed");
    expect(() => job.start()).toThrowError(DomainError);
    expect(() => job.fail("JAVA_PARSE_FAILED", "cannot parse")).toThrowError(DomainError);
  });
});
