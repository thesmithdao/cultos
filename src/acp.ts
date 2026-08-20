import { spawnSync } from "node:child_process";
import { z } from "zod";
import type { IssueWorkContract, PullRequestDelivery } from "./contract.js";

const createJobSchema = z.object({
  jobId: z.union([z.string(), z.number()]),
  chainId: z.number().optional(),
  protocol: z.string().optional()
}).passthrough();

const watchSchema = z.object({
  status: z.string(),
  availableTools: z.array(z.string()).optional(),
  entry: z.unknown().optional()
}).passthrough();

interface CommandResult {
  data: unknown;
  exitCode: number;
}

export interface CreatedJob {
  jobId: string;
  chainId: number;
  protocol?: string;
}

export interface WatchedJob {
  status: string;
  availableTools: string[];
  budget?: string;
  deliverable?: unknown;
  exitCode: number;
  raw: unknown;
}

interface CreateJobInput {
  provider: string;
  offering?: string;
  chainId: number;
  expiry: number;
  contract: IssueWorkContract;
}

function parseOutput(output: string): unknown {
  const trimmed = output.trim();
  if (!trimmed) {
    return {};
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const lines = trimmed.split(/\r?\n/).reverse();
    for (const line of lines) {
      try {
        return JSON.parse(line);
      } catch {
        continue;
      }
    }
  }

  throw new Error("ACP returned an unreadable response");
}

function runAcp(args: string[], acceptedExitCodes = [0]): CommandResult {
  const result = spawnSync("acp", [...args, "--json"], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024
  });
  const exitCode = result.status ?? 1;

  if (!acceptedExitCodes.includes(exitCode)) {
    const detail = result.stderr.trim() || result.stdout.trim() || "ACP command failed";
    throw new Error(detail);
  }

  return {
    data: parseOutput(result.stdout),
    exitCode
  };
}

function eventValue(entry: unknown, key: string): unknown {
  if (!entry || typeof entry !== "object") {
    return undefined;
  }

  const event = "event" in entry ? entry.event : undefined;
  if (!event || typeof event !== "object") {
    return undefined;
  }

  return key in event ? event[key as keyof typeof event] : undefined;
}

export function createJob(input: CreateJobInput): CreatedJob {
  const contract = JSON.stringify(input.contract);
  const args = input.offering
    ? [
        "client",
        "create-job",
        "--provider",
        input.provider,
        "--offering-name",
        input.offering,
        "--requirements",
        contract,
        "--chain-id",
        String(input.chainId)
      ]
    : [
        "client",
        "create-custom-job",
        "--provider",
        input.provider,
        "--description",
        contract,
        "--expired-in",
        String(input.expiry),
        "--chain-id",
        String(input.chainId)
      ];
  const result = createJobSchema.parse(runAcp(args).data);

  return {
    jobId: String(result.jobId),
    chainId: result.chainId ?? input.chainId,
    ...(result.protocol ? { protocol: result.protocol } : {})
  };
}

export function watchJob(jobId: string): WatchedJob {
  const result = runAcp(
    ["job", "watch", "--job-id", jobId],
    [0, 1, 2, 3]
  );
  const watch = watchSchema.parse(result.data);
  const budget = eventValue(watch.entry, "amount");
  const deliverable = eventValue(watch.entry, "deliverable");

  return {
    status: watch.status,
    availableTools: watch.availableTools ?? [],
    ...(budget !== undefined ? { budget: String(budget) } : {}),
    ...(deliverable !== undefined ? { deliverable } : {}),
    exitCode: result.exitCode,
    raw: result.data
  };
}

export function fundJob(jobId: string, chainId: number, amount: string): void {
  runAcp([
    "client",
    "fund",
    "--job-id",
    jobId,
    "--chain-id",
    String(chainId),
    "--amount",
    amount
  ]);
}

export function completeJob(jobId: string, chainId: number, reason: string): void {
  runAcp([
    "client",
    "complete",
    "--job-id",
    jobId,
    "--chain-id",
    String(chainId),
    "--reason",
    reason
  ]);
}

export function rejectJob(jobId: string, chainId: number, reason: string): void {
  runAcp([
    "client",
    "reject",
    "--job-id",
    jobId,
    "--chain-id",
    String(chainId),
    "--reason",
    reason
  ]);
}

export function quoteJob(jobId: string, chainId: number, amount: string): void {
  runAcp([
    "provider",
    "set-budget",
    "--job-id",
    jobId,
    "--chain-id",
    String(chainId),
    "--amount",
    amount
  ]);
}

export function submitJob(jobId: string, chainId: number, delivery: PullRequestDelivery): void {
  runAcp([
    "provider",
    "submit",
    "--job-id",
    jobId,
    "--chain-id",
    String(chainId),
    "--deliverable",
    JSON.stringify(delivery)
  ]);
}

export function sendMessage(jobId: string, chainId: number, content: string): void {
  runAcp([
    "message",
    "send",
    "--job-id",
    jobId,
    "--chain-id",
    String(chainId),
    "--content",
    content
  ]);
}
