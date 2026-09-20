import { beforeEach, describe, expect, test, vi } from "vitest";

const childProcess = vi.hoisted(() => ({
  execFileSync: vi.fn(),
  spawnSync: vi.fn()
}));

vi.mock("node:child_process", () => childProcess);

import { commentOnIssue, getIssue, getPullRequest, getPullRequestChecks, getRepository } from "../src/github.js";

describe("GitHub checks", () => {
  beforeEach(() => {
    childProcess.spawnSync.mockReset();
    childProcess.execFileSync.mockReset();
  });

  test("accepts an empty check list", () => {
    childProcess.spawnSync.mockReturnValue({ status: 1, stdout: "", stderr: "" });

    expect(getPullRequestChecks("https://github.com/example/repo/pull/1")).toEqual([]);
  });

  test("keeps a dash-leading reference out of flag position", () => {
    // `gh` is cobra-based: everything after `--` is positional, so a reference
    // that begins with a dash cannot be read as a flag. Delivery URLs reach
    // `gh pr view` this way and are chosen by the provider.
    childProcess.spawnSync.mockReturnValue({ status: 0, stdout: "[]", stderr: "" });
    getPullRequestChecks("--version");

    const args = childProcess.spawnSync.mock.calls[0]![1] as string[];
    const separator = args.indexOf("--");
    expect(separator).toBeGreaterThan(-1);
    expect(args.slice(separator + 1)).toEqual(["--version"]);
    expect(args.slice(0, separator)).not.toContain("--version");
  });

  test("posts receipts to the job repository", () => {
    childProcess.spawnSync.mockReturnValue({ status: 0, stdout: "", stderr: "" });

    commentOnIssue(2, "receipt", "cultosagent/review-lab");

    expect(childProcess.spawnSync).toHaveBeenCalledWith(
      "gh",
      ["issue", "comment", "--body", "receipt", "--repo", "cultosagent/review-lab", "--", "2"],
      { encoding: "utf8" }
    );
  });
});

describe("GitHub argument separation", () => {
  beforeEach(() => {
    childProcess.execFileSync.mockReset();
  });

  test("puts every reference after the separator", () => {
    const cases: Array<[() => unknown, string, string]> = [
      [
        () => getIssue("--repo=evil/repo", "cultosagent/review-lab"),
        JSON.stringify({
          number: 1,
          title: "t",
          body: null,
          url: "https://github.com/cultosagent/review-lab/issues/1"
        }),
        "--repo=evil/repo"
      ],
      [
        () => getPullRequest("-X"),
        JSON.stringify({
          number: 1,
          url: "https://github.com/cultosagent/review-lab/pull/1",
          state: "OPEN",
          headRefOid: "a".repeat(40),
          baseRefName: "main"
        }),
        "-X"
      ],
      [
        () => getRepository("--json=x"),
        JSON.stringify({
          nameWithOwner: "cultosagent/review-lab",
          url: "https://github.com/cultosagent/review-lab",
          defaultBranchRef: { name: "main" }
        }),
        "--json=x"
      ]
    ];

    for (const [call, stdout, reference] of cases) {
      childProcess.execFileSync.mockReset();
      childProcess.execFileSync.mockReturnValue(stdout);
      call();

      const args = childProcess.execFileSync.mock.calls[0]![1] as string[];
      const separator = args.indexOf("--");
      expect(separator).toBeGreaterThan(-1);
      expect(args.slice(separator + 1)).toEqual([reference]);
      expect(args.slice(0, separator)).not.toContain(reference);
    }
  });
});
