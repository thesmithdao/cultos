import { describe, expect, it } from "vitest";
import {
  createPullRequestDelivery,
  createWorkContract,
  extractAcceptanceCriteria,
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
});

describe("pull-request delivery", () => {
  it("round-trips a provider deliverable", () => {
    const delivery = createPullRequestDelivery(
      "https://github.com/thecultos/example/pull/47",
      "abc123456789"
    );

    expect(parsePullRequestDelivery(JSON.stringify(delivery))).toEqual(delivery);
  });
});
