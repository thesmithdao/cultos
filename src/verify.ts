import type { CultJob } from "./state.js";
import {
  getRepositoryChecks,
  getRepositoryPullRequest,
  type RepositoryCheck,
  type RepositoryPullRequest
} from "./repository.js";

export interface VerificationResult {
  pullRequest: number;
  url: string;
  headSha: string;
  checks: RepositoryCheck[];
  passed: boolean;
  failures: string[];
}

function isPullRequestUrl(repository: string, pullRequest: string): boolean {
  const escapedRepository = repository.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escapedRepository}/pull/[1-9]\\d*$`).test(pullRequest);
}

export function evaluateDelivery(
  job: CultJob,
  pullRequest: RepositoryPullRequest,
  checks: RepositoryCheck[],
  requiredState: "OPEN" | "MERGED" = "OPEN"
): VerificationResult {
  if (!job.delivery) {
    throw new Error("The provider has not submitted a pull-request delivery");
  }
  const failures: string[] = [];
  if (!isPullRequestUrl(job.contract.repository, pullRequest.url)) {
    failures.push("Pull request belongs to a different repository");
  }
  if (pullRequest.baseRef !== job.contract.baseRef) {
    failures.push(`Pull request targets ${pullRequest.baseRef}, expected ${job.contract.baseRef}`);
  }
  if (pullRequest.headSha !== job.delivery.headSha) {
    failures.push("Pull request changed after delivery");
  }
  if (pullRequest.state === "MERGED" && requiredState === "OPEN") {
    failures.push("Pull request is already merged; verify before merging");
  } else if (pullRequest.state !== requiredState) {
    failures.push(`Pull request must be ${requiredState.toLowerCase()}`);
  }

  if (checks.length === 0) {
    failures.push("Pull request has no CI checks");
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

export function verifyJob(
  job: CultJob,
  requiredState: "OPEN" | "MERGED" = "OPEN"
): VerificationResult {
  if (!job.delivery) {
    throw new Error("The provider has not submitted a pull-request delivery");
  }
  const pullRequest = getRepositoryPullRequest(job.delivery.url);
  const checks = getRepositoryChecks(pullRequest);
  return evaluateDelivery(job, pullRequest, checks, requiredState);
}
