import { spawnSync } from "node:child_process";
import { z } from "zod";
import type {
  RepositoryCheck,
  RepositoryInfo,
  RepositoryIssue,
  RepositoryPullRequest
} from "./repository.js";

interface GitLawbReference {
  owner: string;
  repository: string;
}

const pullRequestSchema = z.object({
  number: z.number(),
  source_branch: z.string(),
  target_branch: z.string(),
  status: z.string()
});

const certificateListSchema = z.object({
  certificates: z.array(z.object({
    id: z.string(),
    ref_name: z.string(),
    new_sha: z.string()
  }))
});

function run(args: string[]): string {
  const identityArgs = process.env.CULTOS_GITLAWB_DIR
    ? [...args, "--dir", process.env.CULTOS_GITLAWB_DIR]
    : args;
  const result = spawnSync("gl", identityArgs, {
    encoding: "utf8",
    stdio: ["inherit", "pipe", "pipe"],
    maxBuffer: 10 * 1024 * 1024
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || "GitLawb CLI command failed");
  }
  return result.stdout.trim();
}

function field(output: string, name: string): string {
  const match = output.match(new RegExp(`^\\s*${name}:\\s*(.+)$`, "mi"));
  if (!match?.[1]) throw new Error(`GitLawb response is missing ${name}`);
  return match[1].trim();
}

function ownerKey(owner: string): string {
  return owner.replace(/^did:key:/, "");
}

function api(path: string): unknown {
  const node = (process.env.GITLAWB_NODE ?? "https://node.gitlawb.com").replace(/\/$/, "");
  const result = spawnSync("curl", ["--fail", "--silent", "--show-error", `${node}${path}`], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || "GitLawb API request failed");
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error("GitLawb API returned an unreadable response");
  }
}

function repositoryArgument(reference: GitLawbReference): string {
  return `${ownerKey(reference.owner)}/${reference.repository}`;
}

export function parseGitLawbRemote(value: string): GitLawbReference | undefined {
  const match = value.trim().match(/^gitlawb:\/\/(did:key:[^/]+|[^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!match?.[1] || !match[2]) return undefined;
  return { owner: match[1], repository: match[2] };
}

function currentRepository(): GitLawbReference {
  const result = spawnSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" });
  const parsed = parseGitLawbRemote(result.stdout ?? "");
  if (result.status !== 0 || !parsed) {
    throw new Error("The origin remote is not a GitLawb repository");
  }
  return parsed;
}

function parseRepositoryReference(value?: string): GitLawbReference {
  if (!value) return currentRepository();
  const remote = parseGitLawbRemote(value);
  if (remote) return remote;
  const match = value.match(/^(did:key:[^/]+|[^/]+)\/([^/]+)$/);
  if (!match?.[1] || !match[2]) throw new Error(`Invalid GitLawb repository: ${value}`);
  return { owner: match[1], repository: match[2] };
}

export function getGitLawbRepository(reference?: string): RepositoryInfo {
  const parsed = parseRepositoryReference(reference);
  const output = run(["repo", "info", repositoryArgument(parsed)]);
  const owner = field(output, "Owner DID");
  const name = field(output, "Repository").split("/").at(-1) ?? parsed.repository;
  return {
    platform: "gitlawb",
    nameWithOwner: `${ownerKey(owner)}/${name}`,
    url: `gitlawb://${owner}/${name}`,
    defaultBranch: field(output, "Branch")
  };
}

function issueId(reference: string): string {
  return reference.match(/\/issues\/([^/]+)$/)?.[1] ?? reference;
}

export function getGitLawbIssue(reference: string, repository?: string): RepositoryIssue {
  const repo = parseRepositoryReference(repository);
  const id = issueId(reference);
  const output = run(["issue", "show", repositoryArgument(repo), id]);
  const lines = output.split(/\r?\n/);
  const bodyStart = lines.findIndex((line) => line.trim() === "");
  return {
    id,
    title: field(output, "Title"),
    body: bodyStart >= 0 ? lines.slice(bodyStart + 1).join("\n").trim() : "",
    url: `gitlawb://${repo.owner}/${repo.repository}/issues/${id}`
  };
}

interface PullRequestReference extends GitLawbReference {
  number: number;
}

function parsePullRequestReference(value: string): PullRequestReference {
  const match = value.match(/^(?:gitlawb:\/\/|https:\/\/gitlawb\.com\/)(did:key:[^/]+|[^/]+)\/([^/]+)\/(?:pulls?|prs?)\/(\d+)$/);
  if (!match?.[1] || !match[2] || !match[3]) {
    throw new Error("Invalid GitLawb pull request reference");
  }
  return { owner: match[1], repository: match[2], number: Number(match[3]) };
}

function remoteHeadSha(repository: GitLawbReference, branch: string): string {
  const remote = `gitlawb://${repository.owner}/${repository.repository}`;
  const result = spawnSync("git", ["ls-remote", remote, `refs/heads/${branch}`], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || "Unable to resolve the GitLawb pull-request commit");
  }
  const sha = result.stdout.trim().split(/\s+/)[0];
  if (!sha) throw new Error("GitLawb pull-request branch was not found");
  return sha;
}

export function getGitLawbPullRequest(reference: string): RepositoryPullRequest {
  const parsed = parsePullRequestReference(reference);
  const owner = ownerKey(parsed.owner);
  const pullRequest = pullRequestSchema.parse(api(
    `/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(parsed.repository)}/pulls/${parsed.number}`
  ));
  const headRef = pullRequest.source_branch;
  return {
    platform: "gitlawb",
    number: pullRequest.number,
    url: `gitlawb://${parsed.owner}/${parsed.repository}/pull/${parsed.number}`,
    state: pullRequest.status.toUpperCase(),
    headSha: remoteHeadSha(parsed, headRef),
    headRef,
    baseRef: pullRequest.target_branch
  };
}

export function getGitLawbVerificationChecks(pullRequest: RepositoryPullRequest): RepositoryCheck[] {
  const parsed = parsePullRequestReference(pullRequest.url);
  if (!pullRequest.headRef) {
    return [{ name: "Signed push certificate", state: "missing branch", bucket: "fail" }];
  }
  const owner = ownerKey(parsed.owner);
  const certificates = certificateListSchema.parse(api(
    `/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(parsed.repository)}/certs`
  )).certificates;
  const certificate = certificates.find((item) =>
    item.ref_name === `refs/heads/${pullRequest.headRef}` && item.new_sha === pullRequest.headSha
  );
  if (!certificate) {
    return [{ name: "Signed push certificate", state: "missing", bucket: "fail" }];
  }
  const args = ["cert", "show", `${owner}/${parsed.repository}`, certificate.id, "--verify"];
  if (process.env.CULTOS_GITLAWB_DIR) args.push("--dir", process.env.CULTOS_GITLAWB_DIR);
  const result = spawnSync("gl", args, {
    encoding: "utf8",
    stdio: ["inherit", "pipe", "pipe"],
    maxBuffer: 10 * 1024 * 1024
  });
  return [{
    name: "Signed push certificate",
    state: result.status === 0 ? "verified" : "invalid",
    bucket: result.status === 0 ? "pass" : "fail"
  }];
}

export function commentOnGitLawbIssue(repository: string, issue: string, body: string): void {
  run(["issue", "comment", repository, issue, "--body", body]);
}
