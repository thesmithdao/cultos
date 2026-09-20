import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getGitLawbIssue,
  getGitLawbPullRequest,
  getGitLawbRepository,
  getGitLawbVerificationChecks,
  parseGitLawbRemote
} from "../src/gitlawb.js";

const originalPath = process.env.PATH;
let bin: string;

function executable(name: string, body: string): void {
  const path = join(bin, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
}

beforeEach(() => {
  bin = mkdtempSync(join(tmpdir(), "cultos-gitlawb-"));
  process.env.PATH = `${bin}:${originalPath}`;
  executable("gl", `
case "$1 $2" in
  "repo info") printf '%s\\n' 'Repository: z6MkOwner/example' '  Owner DID:  did:key:z6MkOwner' '  Branch:     main' ;;
  "issue show") printf '%s\\n' 'Issue: issue-id' '  Title:   Fix adapter' '  Status:  open' '' 'Acceptance criteria' '- [ ] Tests pass' ;;
  "pr view") printf '%s\\n' 'PR #1: Fix adapter' '  Status: open' '  Branch: feature/fix → main' ;;
  "cert list") printf '%s\\n' '  abcdef12  2026-08-25T00:00:00  refs/heads/feature/fix  abc123456789' ;;
  "cert show") [ "$3" = "z6MkOwner/example" ] || exit 1; printf '%s\\n' 'Signature verification:' '  VALID' ;;
  *) exit 1 ;;
esac`);
  executable("git", `
if [ "$1" = "ls-remote" ]; then
  printf '%s\\n' 'abc1234567890000000000000000000000000000 refs/heads/feature/fix'
else
  exit 1
fi`);
  executable("curl", `
for argument in "$@"; do url="$argument"; done
case "$url" in
  */pulls/1) printf '%s\\n' '{"number":1,"source_branch":"feature/fix","target_branch":"main","status":"open"}' ;;
  */certs) printf '%s\\n' '{"certificates":[{"id":"abcdef12","ref_name":"refs/heads/feature/fix","new_sha":"abc1234567890000000000000000000000000000"}]}' ;;
  *) exit 1 ;;
esac`);
});

afterEach(() => {
  process.env.PATH = originalPath;
});

describe("GitLawb adapter", () => {
  it("parses repository remotes", () => {
    expect(parseGitLawbRemote("gitlawb://did:key:z6MkOwner/example")).toEqual({
      owner: "did:key:z6MkOwner",
      repository: "example"
    });
  });

  it("reads repositories and UUID issues", () => {
    expect(getGitLawbRepository("z6MkOwner/example")).toMatchObject({
      platform: "gitlawb",
      nameWithOwner: "z6MkOwner/example",
      defaultBranch: "main"
    });
    expect(getGitLawbIssue("issue-id", "z6MkOwner/example")).toMatchObject({
      id: "issue-id",
      title: "Fix adapter",
      body: "Acceptance criteria\n- [ ] Tests pass"
    });
  });

  it("reads pull requests and verifies signed pushes", () => {
    const pullRequest = getGitLawbPullRequest("gitlawb://did:key:z6MkOwner/example/pull/1");
    expect(pullRequest).toMatchObject({
      number: 1,
      state: "OPEN",
      headRef: "feature/fix",
      baseRef: "main",
      headSha: "abc1234567890000000000000000000000000000"
    });
    expect(getGitLawbVerificationChecks(pullRequest)).toEqual([
      { name: "Signed push certificate", state: "verified", bucket: "pass" }
    ]);
  });

  it("refuses to trust a plaintext GitLawb node", () => {
    const node = process.env.GITLAWB_NODE;
    try {
      process.env.GITLAWB_NODE = "http://node.example.com";
      expect(() => getGitLawbPullRequest("gitlawb://did:key:z6MkOwner/example/pull/1"))
        .toThrow(/must use https/);

      process.env.GITLAWB_NODE = "not a url";
      expect(() => getGitLawbPullRequest("gitlawb://did:key:z6MkOwner/example/pull/1"))
        .toThrow(/not a valid URL/);
    } finally {
      if (node === undefined) delete process.env.GITLAWB_NODE;
      else process.env.GITLAWB_NODE = node;
    }
  });

  it("allows a loopback node for local development", () => {
    const node = process.env.GITLAWB_NODE;
    try {
      process.env.GITLAWB_NODE = "http://localhost:8080";
      expect(getGitLawbPullRequest("gitlawb://did:key:z6MkOwner/example/pull/1"))
        .toMatchObject({ number: 1, state: "OPEN" });
    } finally {
      if (node === undefined) delete process.env.GITLAWB_NODE;
      else process.env.GITLAWB_NODE = node;
    }
  });

  it("rejects an issue reference that would read as a flag", () => {
    expect(() => getGitLawbIssue("--dir=/etc", "z6MkOwner/example"))
      .toThrow(/Invalid GitLawb issue reference/);
  });
});
