import { execFileSync, spawnSync } from "node:child_process";
import { z } from "zod";

const issueSchema = z.object({
  number: z.number(),
  title: z.string(),
  body: z.string().nullable(),
  url: z.url()
});

const repositorySchema = z.object({
  nameWithOwner: z.string(),
  url: z.url(),
  defaultBranchRef: z.object({
    name: z.string()
  })
});

const pullRequestSchema = z.object({
  number: z.number(),
  url: z.url(),
  state: z.string(),
  headRefOid: z.string(),
  baseRefName: z.string()
});

const checkSchema = z.object({
  name: z.string(),
  state: z.string(),
  bucket: z.string(),
  link: z.string().optional()
});

export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  url: string;
}

export interface GitHubRepository {
  nameWithOwner: string;
  url: string;
  defaultBranch: string;
}

export interface GitHubPullRequest {
  number: number;
  url: string;
  state: string;
  headSha: string;
  baseRef: string;
}

export interface GitHubCheck {
  name: string;
  state: string;
  bucket: string;
  link?: string | undefined;
}

/**
 * Run `gh` with a JSON response.
 *
 * Callers put every flag before the `--` separator and the reference after it.
 * `gh` is built on cobra, which treats everything following `--` as positional,
 * so a reference that begins with a dash is read as a reference rather than as
 * a flag. Delivery URLs reach `gh pr view` this way and come from the provider.
 */
function runGitHub(args: string[]): unknown {
  try {
    const output = execFileSync("gh", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });

    return JSON.parse(output);
  } catch (error) {
    if (error instanceof Error && "stderr" in error) {
      const stderr = String(error.stderr).trim();
      throw new Error(stderr || "GitHub CLI command failed");
    }

    throw error;
  }
}

function runGitHubWithExitCodes(args: string[], exitCodes: number[]): unknown {
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024
  });
  const exitCode = result.status ?? 1;

  if (!exitCodes.includes(exitCode)) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || "GitHub CLI command failed");
  }

  const output = result.stdout.trim();
  return output ? JSON.parse(output) : [];
}

export function getIssue(reference: string, repository?: string): GitHubIssue {
  const args = ["issue", "view", "--json", "number,title,body,url"];
  if (repository) {
    args.push("--repo", repository);
  }
  args.push("--", reference);
  const issue = issueSchema.parse(
    runGitHub(args)
  );
  if (!issue.url.includes("/issues/")) {
    throw new Error(`${reference} is a pull request, not a GitHub issue`);
  }

  return {
    ...issue,
    body: issue.body ?? ""
  };
}

export function getRepository(reference?: string): GitHubRepository {
  const args = ["repo", "view", "--json", "nameWithOwner,url,defaultBranchRef"];
  if (reference) {
    args.push("--", reference);
  }
  const repository = repositorySchema.parse(
    runGitHub(args)
  );

  return {
    nameWithOwner: repository.nameWithOwner,
    url: repository.url,
    defaultBranch: repository.defaultBranchRef.name
  };
}

export function commandExists(command: string): boolean {
  const result = spawnSync(command, ["--version"], { stdio: "ignore" });
  return result.status === 0;
}

export function githubIsAuthenticated(): boolean {
  const result = spawnSync("gh", ["auth", "status"], { stdio: "ignore" });
  return result.status === 0;
}

export function getPullRequest(reference: string): GitHubPullRequest {
  const pullRequest = pullRequestSchema.parse(
    runGitHub(["pr", "view", "--json", "number,url,state,headRefOid,baseRefName", "--", reference])
  );

  return {
    number: pullRequest.number,
    url: pullRequest.url,
    state: pullRequest.state,
    headSha: pullRequest.headRefOid,
    baseRef: pullRequest.baseRefName
  };
}

export function getPullRequestChecks(reference: string): GitHubCheck[] {
  const checks = z.array(checkSchema).parse(
    runGitHubWithExitCodes(
      ["pr", "checks", "--json", "name,state,bucket,link", "--", reference],
      [0, 1, 8]
    )
  );
  return checks;
}

export function commentOnIssue(issueNumber: number, body: string, repository?: string): void {
  const args = ["issue", "comment", "--body", body];
  if (repository) {
    args.push("--repo", repository);
  }
  args.push("--", String(issueNumber));
  const result = spawnSync("gh", args, {
    encoding: "utf8"
  });

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || "Unable to post the GitHub receipt");
  }
}
