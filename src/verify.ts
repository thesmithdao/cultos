import type { CultJob } from "./state.js";
import {
  getPullRequest,
  getPullRequestChecks,
  type GitHubCheck,
  type GitHubPullRequest
} from "./github.js";

export interface VerificationResult {
  pullRequest: number;
  url: string;
  headSha: string;
  checks: GitHubCheck[];
  passed: boolean;
  failures: string[];
}

export function evaluateDelivery(
  job: CultJob,
  pullRequest: GitHubPullRequest,
  checks: GitHubCheck[]
): VerificationResult {
  if (!job.delivery) {
    throw new Error("The provider has not submitted a pull-request delivery");
  }
  const failures: string[] = [];
  const repositoryPrefix = `${job.contract.repository}/pull/`;

  if (!pullRequest.url.startsWith(repositoryPrefix)) {
    failures.push("Pull request belongs to a different repository");
  }
  if (pullRequest.baseRef !== job.contract.baseRef) {
    failures.push(`Pull request targets ${pullRequest.baseRef}, expected ${job.contract.baseRef}`);
  }
  if (pullRequest.headSha !== job.delivery.headSha) {
    failures.push("Pull request changed after delivery");
  }
  if (pullRequest.state !== "OPEN") {
    failures.push(`Pull request is ${pullRequest.state.toLowerCase()}`);
  }

  const failedChecks = checks.filter((check) => !["pass", "skipping"].includes(check.bucket));
  for (const check of failedChecks) {
    failures.push(`${check.name}: ${check.bucket}`);
  }

  return {
    pullRequest: pullRequest.number,
    url: pullRequest.url,
    headSha: pullRequest.headSha,
    checks,
    passed: failures.length === 0,
    failures
  };
}

export function verifyJob(job: CultJob): VerificationResult {
  if (!job.delivery) {
    throw new Error("The provider has not submitted a pull-request delivery");
  }
  const pullRequest = getPullRequest(job.delivery.url);
  const checks = getPullRequestChecks(job.delivery.url);
  return evaluateDelivery(job, pullRequest, checks);
}
