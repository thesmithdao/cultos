import { spawnSync } from "node:child_process";
import { z } from "zod";
import type { CultWorkContract, PullRequestDelivery } from "./contract.js";

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

const historySchema = z.object({
  jobId: z.string(),
  chainId: z.number().int().positive(),
  status: z.string(),
  entries: z.array(z.unknown()),
  budget: z.union([z.string(), z.number()]).optional(),
  deliverable: z.unknown().optional()
}).passthrough();

const agentValue = z.string().min(1).max(200).refine(value => !/[\u0000-\u001f\u007f-\u009f]/.test(value));
const agentSchema = z.object({
  id: agentValue,
  name: agentValue,
  walletAddress: z.string().regex(/^0x[0-9a-f]{40}$/i),
  role: agentValue.optional()
}).passthrough();

const agentListSchema = z.object({
  data: z.array(agentSchema).max(100)
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

export type AcpAgent = z.infer<typeof agentSchema>;

interface CreateJobInput {
  provider: string;
  offering?: string;
  chainId: number;
  expiry: number;
  contract: CultWorkContract;
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

function errorMessage(output: string): string {
  const trimmed = output.trim();
  if (!trimmed) {
    return "ACP command failed";
  }

  if (/NOT_AUTHENTICATED|Not authenticated/i.test(trimmed)) {
    return "ACP authentication required. Run cult start.";
  }
  if (/NO_SIGNER|no signer configured/i.test(trimmed)) {
    return "ACP signer required. Run cult start.";
  }

  try {
    const parsed = z.object({
      error: z.string(),
      recovery: z.string().optional()
    }).passthrough().parse(JSON.parse(trimmed));
    return parsed.recovery ? `${parsed.error}. ${parsed.recovery}` : parsed.error;
  } catch {
    return trimmed;
  }
}

function runAcp(args: string[], acceptedExitCodes = [0]): CommandResult {
  const result = spawnSync("acp", [...args, "--json"], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024
  });
  const exitCode = result.status ?? 1;

  if (result.error) {
    throw new Error("code" in result.error && result.error.code === "ENOENT"
      ? "ACP is not installed. Run cult start."
      : "Unable to run ACP. Run cult doctor.");
  }

  if (!acceptedExitCodes.includes(exitCode)) {
    const output = result.stderr.trim() ? result.stderr : result.stdout;
    throw new Error(errorMessage(output));
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

export function listAgents(): AcpAgent[] {
  return agentListSchema.parse(runAcp(["agent", "list"]).data).data;
}

export function currentAgent(): AcpAgent {
  return agentSchema.parse(runAcp(["agent", "whoami"]).data);
}

export function useAgent(agentId: string): AcpAgent {
  const selector = agentValue.parse(agentId.trim());
  const agents = listAgents();
  const exact = agents.find(agent => agent.id === selector);
  const matches = exact ? [exact] : agents.filter(agent => agent.name.toLowerCase() === selector.toLowerCase());
  if (matches.length === 0) throw new Error("Agent not found. Run cult agent list.");
  if (matches.length > 1) throw new Error("Agent name is ambiguous. Use its ID from cult agent list.");
  const id = matches[0]!.id;
  runAcp(["agent", "use", "--agent-id", id]);
  return currentAgent();
}

export function requireProviderIdentity(expectedWallet?: string): AcpAgent {
  const active = currentAgent();
  if (!expectedWallet || active.walletAddress.toLowerCase() === expectedWallet.toLowerCase()) return active;
  const provider = listAgents().find(agent => agent.walletAddress.toLowerCase() === expectedWallet.toLowerCase());
  const recovery = provider
    ? `Run cult agent use ${provider.id}`
    : `Select the ACP agent for ${expectedWallet}`;
  throw new Error(`Active agent ${active.walletAddress} is not provider ${expectedWallet}. ${recovery}`);
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

export function jobHistory(jobId: string, chainId = 8453): WatchedJob {
  const history = historySchema.parse(runAcp([
    "job", "history", "--job-id", jobId, "--chain-id", String(chainId)
  ]).data);
  if (history.jobId !== jobId || history.chainId !== chainId) {
    throw new Error("ACP returned history for a different job or chain");
  }
  let budget = history.budget;
  let deliverable = history.deliverable;
  for (const entry of history.entries) {
    if (eventValue(entry, "type") === "budget.set") {
      budget = z.union([z.string(), z.number()]).parse(eventValue(entry, "amount"));
    }
    if (eventValue(entry, "type") === "job.submitted") {
      deliverable = eventValue(entry, "deliverable");
    }
  }
  return {
    status: history.status,
    availableTools: [],
    ...(budget !== undefined ? { budget: String(budget) } : {}),
    ...(deliverable !== undefined ? { deliverable } : {}),
    exitCode: 0,
    raw: history
  };
}

export function watchJob(jobId: string, timeout?: number, chainId = 8453): WatchedJob {
  const history = jobHistory(jobId, chainId);
  if (["budget_set", "submitted", "completed", "rejected", "expired"].includes(history.status)) {
    return history;
  }
  const args = ["job", "watch", "--job-id", jobId, "--chain-id", String(chainId)];
  if (timeout !== undefined) {
    args.push("--timeout", String(timeout));
  }
  let result: CommandResult;
  try {
    result = runAcp(args, [0, 1, 2, 3]);
  } catch (error) {
    if (
      timeout !== undefined
      && error instanceof Error
      && /^(Watching job|Timed out)/.test(error.message)
    ) {
      throw new Error(`No ACP update within ${timeout} seconds`);
    }
    throw error;
  }
  const watch = watchSchema.parse(result.data);
  const recovered = jobHistory(jobId, chainId);
  const budget = recovered.budget ?? eventValue(watch.entry, "amount");
  const deliverable = recovered.deliverable ?? eventValue(watch.entry, "deliverable");

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
