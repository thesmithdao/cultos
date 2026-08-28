import type { CultJob } from "./state.js";
import { isAeonReviewDelivery, type AeonReviewDelivery } from "./contract.js";
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

export interface ReviewVerificationResult {
  pullRequest: number;
  url: string;
  headSha: string;
  verdict: "approve-ready" | "discussion-needed" | "blocked";
  summary: string;
  findings: AeonReviewDelivery["findings"];
  runUrl: string;
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
  if (job.contract.kind === "cultos.github.review.v1" || isAeonReviewDelivery(job.delivery)) {
    throw new Error("Expected a pull-request delivery");
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

export function evaluateReviewDelivery(
  job: CultJob,
  pullRequest: RepositoryPullRequest
): ReviewVerificationResult {
  if (job.contract.kind !== "cultos.github.review.v1") {
    throw new Error("Expected an Aeon review contract");
  }
  if (!job.delivery || !isAeonReviewDelivery(job.delivery)) {
    throw new Error("The provider has not submitted an Aeon review");
  }
  const delivery = job.delivery;
  const repository = new URL(job.contract.repository).pathname.replace(/^\//, "").replace(/\/$/, "");
  const issue = Number(new URL(job.contract.issue).pathname.split("/").at(-1));
  const expectedPullRequest = Number(new URL(job.contract.pullRequest).pathname.split("/").at(-1));
  const failures: string[] = [];

  if (delivery.status !== "complete") failures.push(`Review status is ${delivery.status}`);
  if (delivery.repository !== repository) failures.push("Review belongs to a different repository");
  if (delivery.issue !== issue) failures.push("Review belongs to a different issue");
  if (delivery.pull_request !== expectedPullRequest || pullRequest.number !== expectedPullRequest) {
    failures.push("Review belongs to a different pull request");
  }
  if (pullRequest.url !== job.contract.pullRequest) failures.push("Pull request URL changed");
  if (delivery.head_sha !== job.contract.headSha || pullRequest.headSha !== job.contract.headSha) {
    failures.push("Pull request changed after review");
  }

  return {
    pullRequest: expectedPullRequest,
    url: pullRequest.url,
    headSha: pullRequest.headSha,
    verdict: delivery.verdict,
    summary: delivery.summary,
    findings: delivery.findings,
    runUrl: delivery.run.url,
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
  if (job.contract.kind === "cultos.github.review.v1" || isAeonReviewDelivery(job.delivery)) {
    throw new Error("Expected a pull-request delivery");
  }
  const pullRequest = getRepositoryPullRequest(job.delivery.url);
  const checks = getRepositoryChecks(pullRequest);
  return evaluateDelivery(job, pullRequest, checks, requiredState);
}

export function verifyReviewJob(job: CultJob): ReviewVerificationResult {
  if (job.contract.kind !== "cultos.github.review.v1") {
    throw new Error("Expected an Aeon review contract");
  }
  return evaluateReviewDelivery(job, getRepositoryPullRequest(job.contract.pullRequest));
}
