import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { deliveryUrl, httpsUrl, plainText } from "./contract.js";
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
  url: deliveryUrl,
  headSha: z.string().regex(/^[0-9a-f]{7,64}$/)
});

const reviewDeliverySchema = z.object({
  schema: z.literal("cultos.aeon.review.v1"),
  status: z.enum(["complete", "invalid", "unsupported"]),
  repository: z.string().min(1),
  issue: z.number().int().positive(),
  pull_request: z.number().int().positive(),
  head_sha: z.string().regex(/^[0-9a-f]{40}$/),
  verdict: z.enum(["approve-ready", "discussion-needed", "blocked"]),
  summary: plainText(240),
  findings: z.array(z.object({
    severity: z.enum(["critical", "high", "medium"]),
    path: plainText(512),
    line: z.number().int().positive().nullable(),
    title: plainText(240),
    consequence: plainText(500)
  })).max(5),
  reviewed_files: z.array(plainText(512)).max(500),
  limitations: z.array(plainText(500)).max(50),
  run: z.object({
    id: z.number().int().positive(),
    url: httpsUrl,
    model: plainText(120),
    gateway: plainText(120),
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

let resolvedStatePath: string | undefined;

/**
 * Where this repository's job state lives.
 *
 * Resolved on first use rather than at import. As a module-level constant this
 * spawned `git rev-parse` every time the CLI started, including for
 * `--version`, `--help` and `doctor`, and made the module impossible to import
 * outside a git repository.
 */
function statePath(): string {
  resolvedStatePath ??= join(repositoryRoot(), ".cultos", "jobs.json");
  return resolvedStatePath;
}

function emptyState(): CultState {
  return { version: 1, jobs: Object.create(null) as CultState["jobs"] };
}

/**
 * Fail on a job key that cannot survive being stored.
 *
 * A GitLawb issue id is an arbitrary string, so it can be `__proto__`.
 * Assigning that to a plain object reassigns the prototype instead of adding a
 * key, and the job serialises away to nothing -- after the ACP job already
 * exists on-chain. zod does not help here: it drops the key from a record
 * silently rather than reporting it, so the check has to run first.
 *
 * Only `__proto__` is rejected. Names like `constructor` are ordinary own
 * properties once the map has a null prototype and lookups use Object.hasOwn.
 */
function assertStorableJobKeys(value: unknown): void {
  if (!value || typeof value !== "object") return;
  const jobs = (value as { jobs?: unknown }).jobs;
  if (!jobs || typeof jobs !== "object") return;
  if (Object.getOwnPropertyNames(jobs).includes("__proto__")) {
    throw new Error(
      "Job key __proto__ is a reserved name and cannot be stored. "
      + "Remove that entry from the state file."
    );
  }
}

export function assertStorableJobReference(value: number | string): void {
  if (String(value) === "__proto__") {
    throw new Error("Issue reference __proto__ is reserved and cannot be stored");
  }
}

export function parseCultState(value: unknown): CultState {
  assertStorableJobKeys(value);
  const state = stateSchema.parse(value) as CultState;
  // zod returns a plain object, so a lookup for an inherited name such as
  // `toString` would return a function and pass a truthiness check.
  return { ...state, jobs: Object.assign(Object.create(null), state.jobs) };
}

// One command reads the state up to four times: getJob, then updateJob's own
// getJob and saveJob, then printJob. Each read re-parsed the whole file. The
// CLI is one shot per process and writeState refreshes this, so a cache held
// for the life of the process cannot go stale.
let cachedState: CultState | undefined;

function readState(): CultState {
  if (cachedState) return cachedState;

  let contents: string;
  try {
    contents = readFileSync(statePath(), "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      cachedState = emptyState();
      return cachedState;
    }
    throw error;
  }

  try {
    cachedState = parseCultState(JSON.parse(contents));
    return cachedState;
  } catch (error) {
    const reason = error instanceof z.ZodError
      ? error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")
      : error instanceof SyntaxError
        ? "the file is not valid JSON"
        : error instanceof Error ? error.message : String(error);
    throw new Error(
      `${statePath()} was rejected: ${reason}. `
      + "A delivery recorded by an earlier release may predate the current validation; "
      + "remove the job entry or the file to start over."
    );
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
  writeStateFile(statePath(), state);
  cachedState = state;
}

export function jobReference(job: {
  issueNumber: number | string;
  service?: "review" | undefined;
}): string {
  return job.service === "review" ? `${job.issueNumber}:review` : String(job.issueNumber);
}

export function saveJob(job: CultJob): void {
  assertStorableJobReference(job.issueNumber);
  const state = readState();
  const jobs = Object.assign(Object.create(null) as CultState["jobs"], state.jobs);
  jobs[jobReference(job)] = job;
  writeState({ ...state, jobs });
}

export function getJob(issueNumber: number | string): CultJob {
  const jobs = readState().jobs;
  const key = String(issueNumber);
  const job = Object.hasOwn(jobs, key) ? jobs[key] : undefined;
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
