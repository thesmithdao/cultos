import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { IssueWorkContract, PullRequestDelivery } from "./contract.js";

export interface CultJob {
  issueNumber: number;
  repository: string;
  contract: IssueWorkContract;
  provider: string;
  offering?: string;
  jobId: string;
  chainId: number;
  protocol?: string;
  status: string;
  budget?: string;
  delivery?: PullRequestDelivery;
  createdAt: string;
  updatedAt: string;
}

interface CultState {
  version: 1;
  jobs: Record<string, CultJob>;
}

function repositoryRoot(): string {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return process.cwd();
  }
}

const statePath = join(repositoryRoot(), ".cultos", "jobs.json");

function emptyState(): CultState {
  return { version: 1, jobs: {} };
}

function readState(): CultState {
  try {
    return JSON.parse(readFileSync(statePath, "utf8")) as CultState;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return emptyState();
    }
    throw error;
  }
}

function writeState(state: CultState): void {
  mkdirSync(dirname(statePath), { recursive: true });
  const temporaryPath = `${statePath}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, statePath);
}

export function saveJob(job: CultJob): void {
  const state = readState();
  state.jobs[String(job.issueNumber)] = job;
  writeState(state);
}

export function getJob(issueNumber: number): CultJob {
  const job = readState().jobs[String(issueNumber)];
  if (!job) {
    throw new Error(`No CultOS job is linked to issue #${issueNumber}`);
  }
  return job;
}

export function updateJob(issueNumber: number, update: Partial<CultJob>): CultJob {
  const job = getJob(issueNumber);
  const next = {
    ...job,
    ...update,
    updatedAt: new Date().toISOString()
  };
  saveJob(next);
  return next;
}

export function listJobs(): CultJob[] {
  return Object.values(readState().jobs).sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt)
  );
}
