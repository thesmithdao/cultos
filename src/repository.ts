import { spawnSync } from "node:child_process";
import {
  commentOnIssue as commentOnGitHubIssue,
  getIssue as getGitHubIssue,
  getPullRequest as getGitHubPullRequest,
  getPullRequestChecks,
  getRepository as getGitHubRepository
} from "./github.js";
import {
  commentOnGitLawbIssue,
  getGitLawbIssue,
  getGitLawbPullRequest,
  getGitLawbRepository,
  getGitLawbVerificationChecks,
  parseGitLawbRemote
} from "./gitlawb.js";
import type { RepositoryPlatform } from "./contract.js";

export interface RepositoryInfo {
  platform: RepositoryPlatform;
  nameWithOwner: string;
  url: string;
  defaultBranch: string;
}

export interface RepositoryIssue {
  id: number | string;
  title: string;
  body: string;
  url: string;
}

export interface RepositoryPullRequest {
  platform?: RepositoryPlatform;
  number: number;
  url: string;
  state: string;
  headSha: string;
  headRef?: string;
  baseRef: string;
}

export interface RepositoryCheck {
  name: string;
  state: string;
  bucket: string;
  link?: string | undefined;
}

function currentRemote(): string {
  const result = spawnSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error("Unable to read the origin remote");
  }
  return result.stdout.trim();
}

export function detectRepositoryPlatform(): RepositoryPlatform {
  return parseGitLawbRemote(currentRemote()) ? "gitlawb" : "github";
}

export function getRepositoryInfo(
  reference?: string,
  platform: RepositoryPlatform = detectRepositoryPlatform()
): RepositoryInfo {
  if (platform === "gitlawb") return getGitLawbRepository(reference);
  return { platform, ...getGitHubRepository(reference) };
}

export function getRepositoryIssue(
  reference: string,
  repository?: string,
  platform: RepositoryPlatform = detectRepositoryPlatform()
): RepositoryIssue {
  if (platform === "gitlawb") return getGitLawbIssue(reference, repository);
  const issue = getGitHubIssue(reference, repository);
  return { id: issue.number, title: issue.title, body: issue.body, url: issue.url };
}

export function getRepositoryPullRequest(reference: string): RepositoryPullRequest {
  if (reference.startsWith("gitlawb://") || reference.includes("gitlawb.com/")) {
    return getGitLawbPullRequest(reference);
  }
  const pullRequest = getGitHubPullRequest(reference);
  return { platform: "github", headRef: "", ...pullRequest };
}

export function getRepositoryChecks(pullRequest: RepositoryPullRequest): RepositoryCheck[] {
  return pullRequest.platform === "gitlawb"
    ? getGitLawbVerificationChecks(pullRequest)
    : getPullRequestChecks(pullRequest.url);
}

export function commentOnRepositoryIssue(
  platform: RepositoryPlatform,
  repository: string,
  issue: number | string,
  body: string
): void {
  if (platform === "gitlawb") {
    commentOnGitLawbIssue(repository, String(issue), body);
    return;
  }
  commentOnGitHubIssue(Number(issue), body);
}
