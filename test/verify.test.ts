import { describe, expect, it } from "vitest";
import type { CultJob } from "../src/state.js";
import { evaluateDelivery } from "../src/verify.js";

const job: CultJob = {
  issueNumber: 42,
  repository: "thecultos/example",
  contract: {
    kind: "cultos.github.issue.v1",
    repository: "https://github.com/thecultos/example",
    issue: "https://github.com/thecultos/example/issues/42",
    baseRef: "main",
    title: "Fix wallet balance parsing",
    acceptanceCriteria: ["Tests pass"],
    delivery: { type: "github.pull_request" }
  },
  provider: "0x1234",
  jobId: "813",
  chainId: 8453,
  status: "submitted",
  delivery: {
    kind: "cultos.github.pull-request.v1",
    url: "https://github.com/thecultos/example/pull/47",
    headSha: "abc123456789"
  },
  createdAt: "2026-08-20T12:00:00.000Z",
  updatedAt: "2026-08-20T12:00:00.000Z"
};

describe("evaluateDelivery", () => {
  it("accepts an unchanged pull request with passing checks", () => {
    const result = evaluateDelivery(
      job,
      {
        number: 47,
        url: "https://github.com/thecultos/example/pull/47",
        state: "OPEN",
        headSha: "abc123456789",
        baseRef: "main"
      },
      [{ name: "test", state: "SUCCESS", bucket: "pass" }]
    );

    expect(result.passed).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("rejects a delivery that changed after submission", () => {
    const result = evaluateDelivery(
      job,
      {
        number: 47,
        url: "https://github.com/thecultos/example/pull/47",
        state: "OPEN",
        headSha: "different123",
        baseRef: "main"
      },
      [{ name: "test", state: "FAILURE", bucket: "fail" }]
    );

    expect(result.passed).toBe(false);
    expect(result.failures).toContain("Pull request changed after delivery");
    expect(result.failures).toContain("test: fail");
  });
});
