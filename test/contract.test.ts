import { describe, expect, it } from "vitest";
import {
  createReviewContract,
  createPullRequestDelivery,
  createWorkContract,
  extractAcceptanceCriteria,
  parseAeonReviewDelivery,
  parsePullRequestDelivery
} from "../src/contract.js";

describe("extractAcceptanceCriteria", () => {
  it("reads task-list items", () => {
    const body = [
      "## Work",
      "",
      "- [ ] Parse balances using token decimals",
      "- [x] Preserve the existing API"
    ].join("\n");

    expect(extractAcceptanceCriteria(body)).toEqual([
      "Parse balances using token decimals",
      "Preserve the existing API"
    ]);
  });

  it("reads bullets from an acceptance section", () => {
    const body = [
      "## Context",
      "Something is broken.",
      "",
      "## Acceptance criteria",
      "- Add a regression test",
      "- Existing checks pass",
      "",
      "## Notes",
      "- This is not a criterion"
    ].join("\n");

    expect(extractAcceptanceCriteria(body)).toEqual([
      "Add a regression test",
      "Existing checks pass"
    ]);
  });
});

describe("createWorkContract", () => {
  it("creates a GitHub pull-request contract", () => {
    expect(
      createWorkContract({
        repositoryUrl: "https://github.com/thecultos/example",
        issueUrl: "https://github.com/thecultos/example/issues/42",
        baseRef: "main",
        title: "Fix wallet balance parsing",
        body: "- [ ] Add a regression test"
      })
    ).toEqual({
      kind: "cultos.github.issue.v1",
      repository: "https://github.com/thecultos/example",
      issue: "https://github.com/thecultos/example/issues/42",
      baseRef: "main",
      title: "Fix wallet balance parsing",
      acceptanceCriteria: ["Add a regression test"],
      delivery: {
        type: "github.pull_request"
      }
    });
  });

  it("creates a GitLawb pull-request contract", () => {
    expect(
      createWorkContract({
        platform: "gitlawb",
        repositoryUrl: "gitlawb://did:key:z6MkOwner/example",
        issueUrl: "gitlawb://did:key:z6MkOwner/example/issues/issue-id",
        baseRef: "main",
        title: "Add signed delivery",
        body: "- [ ] Verify the certificate"
      })
    ).toMatchObject({
      kind: "cultos.gitlawb.issue.v1",
      delivery: { type: "gitlawb.pull_request" }
    });
  });
});

describe("pull-request delivery", () => {
  it("round-trips a provider deliverable", () => {
    const delivery = createPullRequestDelivery(
      "https://github.com/thecultos/example/pull/47",
      "abc123456789"
    );

    expect(parsePullRequestDelivery(JSON.stringify(delivery))).toEqual(delivery);
  });

  it("round-trips a GitLawb deliverable", () => {
    const delivery = createPullRequestDelivery(
      "gitlawb://did:key:z6MkOwner/example/pull/1",
      "abc123456789",
      "gitlawb"
    );

    expect(parsePullRequestDelivery(JSON.stringify(delivery))).toEqual(delivery);
  });

  it("rejects a delivery URL that is not a pull-request location", () => {
    for (const url of [
      "--repo",
      "javascript:alert(1)",
      "http://github.com/thecultos/example/pull/47",
      "file:///etc/passwd",
      "gitlawb://did:key:z6MkOwner/example/tree/main"
    ]) {
      expect(() => parsePullRequestDelivery({
        kind: "cultos.github.pull-request.v1",
        url,
        headSha: "abc123456789"
      })).toThrow();
    }
  });

  it("rejects escape sequences hidden in a delivery URL", () => {
    expect(() => parsePullRequestDelivery({
      kind: "cultos.github.pull-request.v1",
      url: "https://github.com/thecultos/example/pull/47\u001b[2K",
      headSha: "abc123456789"
    })).toThrow();
  });

  it("rejects a head SHA that is not a commit", () => {
    expect(() => parsePullRequestDelivery({
      kind: "cultos.github.pull-request.v1",
      url: "https://github.com/thecultos/example/pull/47",
      headSha: "--upload-pack=touch /tmp/x"
    })).toThrow();
  });
});

describe("Aeon review contract", () => {
  it("pins one pull request commit", () => {
    expect(createReviewContract({
      repositoryUrl: "https://github.com/thecultos/example",
      issueUrl: "https://github.com/thecultos/example/issues/42",
      pullRequestUrl: "https://github.com/thecultos/example/pull/47",
      headSha: "a".repeat(40)
    })).toEqual({
      kind: "cultos.github.review.v1",
      repository: "https://github.com/thecultos/example",
      issue: "https://github.com/thecultos/example/issues/42",
      pullRequest: "https://github.com/thecultos/example/pull/47",
      headSha: "a".repeat(40),
      delivery: { type: "aeon.review" }
    });
  });

  it("parses a bounded review delivery", () => {
    expect(parseAeonReviewDelivery({
      schema: "cultos.aeon.review.v1",
      status: "complete",
      repository: "thecultos/example",
      issue: 42,
      pull_request: 47,
      head_sha: "a".repeat(40),
      verdict: "approve-ready",
      summary: "No material defects found.",
      findings: [],
      reviewed_files: ["src/index.ts"],
      limitations: [],
      run: {
        id: 91,
        url: "https://github.com/cultosdev/aeon/actions/runs/91",
        model: "anthropic/claude-sonnet-4",
        gateway: "openrouter",
        usage: { input_tokens: 10, output_tokens: 20 }
      }
    }).verdict).toBe("approve-ready");
  });

  it("rejects escape sequences in provider-written review text", () => {
    const delivery = {
      schema: "cultos.aeon.review.v1",
      status: "complete",
      repository: "thecultos/example",
      issue: 42,
      pull_request: 47,
      head_sha: "a".repeat(40),
      verdict: "approve-ready",
      summary: "No material defects found.",
      findings: [],
      reviewed_files: ["src/index.ts"],
      limitations: [],
      run: {
        id: 91,
        url: "https://github.com/cultosdev/aeon/actions/runs/91",
        model: "anthropic/claude-sonnet-4",
        gateway: "openrouter",
        usage: { input_tokens: 10, output_tokens: 20 }
      }
    };

    expect(() => parseAeonReviewDelivery({
      ...delivery,
      summary: "All good.\u001b[2K\u001b[A\u001b[2KVerified."
    })).toThrow();

    expect(() => parseAeonReviewDelivery({
      ...delivery,
      findings: [{
        severity: "medium",
        path: "src/index.ts",
        line: 1,
        title: "Looks fine\r  Verified at abcdef123456",
        consequence: "None."
      }]
    })).toThrow();
  });

  it("rejects a review run URL that is not https", () => {
    expect(() => parseAeonReviewDelivery({
      schema: "cultos.aeon.review.v1",
      status: "complete",
      repository: "thecultos/example",
      issue: 42,
      pull_request: 47,
      head_sha: "a".repeat(40),
      verdict: "approve-ready",
      summary: "No material defects found.",
      findings: [],
      reviewed_files: [],
      limitations: [],
      run: {
        id: 91,
        url: "http://evil.example/run/91",
        model: "anthropic/claude-sonnet-4",
        gateway: "openrouter",
        usage: { input_tokens: 10, output_tokens: 20 }
      }
    })).toThrow();
  });
});
