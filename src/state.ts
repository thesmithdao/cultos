import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { CultDelivery, CultWorkContract } from "./contract.js";

export interface CultJob {
  issueNumber: number | string;
  service?: "review";
  repository: string;
  contract: CultWorkContract;
  provider: string;
  offering?: string;
  jobId: string;
  chainId: number;
  protocol?: string;
  status: string;
  budget?: string;
  delivery?: CultDelivery;
  settledByCultos?: "completed" | "rejected";
  receiptPostedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CultState {
  version: 1;
  jobs: Record<string, CultJob>;
}

const issueWorkContractSchema = z.object({
  kind: z.union([z.literal("cultos.github.issue.v1"), z.literal("cultos.gitlawb.issue.v1")]),
  repository: z.string().min(1),
  issue: z.string().min(1),
  baseRef: z.string().min(1),
  title: z.string().min(1),
  acceptanceCriteria: z.array(z.string()),
  delivery: z.object({
    type: z.union([z.literal("github.pull_request"), z.literal("gitlawb.pull_request")])
  })
});

const reviewWorkContractSchema = z.object({
  kind: z.literal("cultos.github.review.v1"),
  repository: z.string().min(1),
  issue: z.string().min(1),
  pullRequest: z.string().min(1),
  headSha: z.string().regex(/^[0-9a-f]{40}$/),
  delivery: z.object({ type: z.literal("aeon.review") })
});

const workContractSchema = z.union([issueWorkContractSchema, reviewWorkContractSchema]);

const deliverySchema = z.object({
  kind: z.union([
    z.literal("cultos.github.pull-request.v1"),
    z.literal("cultos.gitlawb.pull-request.v1")
  ]),
  url: z.string().min(1),
  headSha: z.string().min(7)
});

const reviewDeliverySchema = z.object({
  schema: z.literal("cultos.aeon.review.v1"),
  status: z.enum(["complete", "invalid", "unsupported"]),
  repository: z.string().min(1),
  issue: z.number().int().positive(),
  pull_request: z.number().int().positive(),
  head_sha: z.string().regex(/^[0-9a-f]{40}$/),
  verdict: z.enum(["approve-ready", "discussion-needed", "blocked"]),
  summary: z.string().min(1).max(240),
  findings: z.array(z.object({
    severity: z.enum(["critical", "high", "medium"]),
    path: z.string().min(1),
    line: z.number().int().positive().nullable(),
    title: z.string().min(1),
    consequence: z.string().min(1)
  })).max(5),
  reviewed_files: z.array(z.string()),
  limitations: z.array(z.string()),
  run: z.object({
    id: z.number().int().positive(),
    url: z.string().min(1),
    model: z.string().min(1),
    gateway: z.string().min(1),
    usage: z.object({
      input_tokens: z.number().int().nonnegative(),
      output_tokens: z.number().int().nonnegative()
    })
  })
});

const jobSchema = z.object({
  issueNumber: z.union([z.number().int().positive(), z.string().min(1)]),
  service: z.literal("review").optional(),
  repository: z.string().min(1),
  contract: workContractSchema,
  provider: z.string().min(1),
  offering: z.string().optional(),
  jobId: z.string().min(1),
  chainId: z.number().int().positive(),
  protocol: z.string().optional(),
  status: z.string().min(1),
  budget: z.string().optional(),
  delivery: z.union([deliverySchema, reviewDeliverySchema]).optional(),
  settledByCultos: z.enum(["completed", "rejected"]).optional(),
  receiptPostedAt: z.string().min(1).optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1)
});

const stateSchema = z.object({
  version: z.literal(1),
  jobs: z.record(z.string(), jobSchema)
}).superRefine((state, context) => {
  for (const [key, job] of Object.entries(state.jobs)) {
    if (key !== jobReference(job)) {
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

export function jobReference(job: {
  issueNumber: number | string;
  service?: "review" | undefined;
}): string {
  return job.service === "review" ? `${job.issueNumber}:review` : String(job.issueNumber);
}

export function saveJob(job: CultJob): void {
  const state = readState();
  state.jobs[jobReference(job)] = job;
  writeState(state);
}

export function getJob(issueNumber: number | string): CultJob {
  const job = readState().jobs[String(issueNumber)];
  if (!job) {
    throw new Error(`No CultOS job is linked to issue #${issueNumber}`);
  }
  return job;
}

export function updateJob(issueNumber: number | string, update: Partial<CultJob>): CultJob {
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
