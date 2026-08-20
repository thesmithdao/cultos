import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
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

export interface CultState {
  version: 1;
  jobs: Record<string, CultJob>;
}

const workContractSchema = z.object({
  kind: z.literal("cultos.github.issue.v1"),
  repository: z.url(),
  issue: z.url(),
  baseRef: z.string().min(1),
  title: z.string().min(1),
  acceptanceCriteria: z.array(z.string()),
  delivery: z.object({ type: z.literal("github.pull_request") })
});

const deliverySchema = z.object({
  kind: z.literal("cultos.github.pull-request.v1"),
  url: z.url(),
  headSha: z.string().min(7)
});

const jobSchema = z.object({
  issueNumber: z.number().int().positive(),
  repository: z.string().min(1),
  contract: workContractSchema,
  provider: z.string().min(1),
  offering: z.string().optional(),
  jobId: z.string().min(1),
  chainId: z.number().int().positive(),
  protocol: z.string().optional(),
  status: z.string().min(1),
  budget: z.string().optional(),
  delivery: deliverySchema.optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1)
});

const stateSchema = z.object({
  version: z.literal(1),
  jobs: z.record(z.string(), jobSchema)
}).superRefine((state, context) => {
  for (const [key, job] of Object.entries(state.jobs)) {
    if (key !== String(job.issueNumber)) {
      context.addIssue({
        code: "custom",
        message: `Job key ${key} does not match issue #${job.issueNumber}`,
        path: ["jobs", key]
      });
    }
  }
});

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

export function parseCultState(value: unknown): CultState {
  return stateSchema.parse(value) as CultState;
}

function readState(): CultState {
  try {
    return parseCultState(JSON.parse(readFileSync(statePath, "utf8")));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return emptyState();
    }
    throw error;
  }
}

export function writeStateFile(path: string, state: CultState): void {
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600
  });
  renameSync(temporaryPath, path);
  chmodSync(path, 0o600);
}

function writeState(state: CultState): void {
  writeStateFile(statePath, state);
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
