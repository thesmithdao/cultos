import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import pc from "picocolors";
import { z } from "zod";
import { runBbs } from "./bbs.js";

interface CommandResult {
  status: number;
  stdout: string;
  stderr: string;
}

interface StartOptions {
  confirm?: (question: string) => Promise<boolean>;
  wait?: () => Promise<void>;
  launch?: () => void;
  allowNonInteractive?: boolean;
}

const agentSchema = z.object({
  id: z.string(),
  name: z.string(),
  walletAddress: z.string()
}).passthrough();

const agentListSchema = z.object({
  data: z.array(agentSchema)
}).passthrough();

const activeAgentSchema = z.object({
  id: z.string(),
  name: z.string(),
  walletAddress: z.string()
}).passthrough();

const signerSchema = z.object({
  matched: z.boolean().optional(),
  signerId: z.string().optional(),
  policy: z.string().optional()
}).passthrough();

function captured(command: string, args: string[], timeout = 15_000): CommandResult {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    timeout
  });

  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? result.error?.message ?? ""
  };
}

function interactive(command: string, args: string[], timeout?: number): boolean {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    ...(timeout ? { timeout } : {})
  });
  return result.status === 0;
}

function exists(command: string): boolean {
  return captured(command, ["--version"]).status === 0;
}

function parseJson(value: string): unknown {
  return JSON.parse(value.trim());
}

function parsed<T>(schema: z.ZodType<T>, value: string): T | undefined {
  try {
    return schema.parse(parseJson(value));
  } catch {
    return undefined;
  }
}

function authenticationRequired(result: CommandResult): boolean {
  return /NOT_AUTHENTICATED|not authenticated|acp configure/i.test(`${result.stdout}\n${result.stderr}`);
}

function signerMissing(result: CommandResult): boolean {
  return /NO_SIGNER|no signer configured/i.test(`${result.stdout}\n${result.stderr}`);
}

function githubRepository(remote: string): string | undefined {
  return remote.trim().match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/)?.[1];
}

function hasSigner(value: string): boolean {
  const signer = parsed(signerSchema, value);
  return Boolean(signer?.signerId)
    || signer?.matched === true;
}

function signerPolicy(value: string): string {
  return parsed(signerSchema, value)?.policy ?? "ready";
}

function verifySigner(): CommandResult {
  return captured("acp", [
    "wallet",
    "sign-message",
    "--message",
    "CultOS readiness check",
    "--chain-id",
    "8453",
    "--json"
  ]);
}

async function defaultConfirm(question: string): Promise<boolean> {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await prompt.question(`${question} [Y/n] `);
    return !["n", "no"].includes(answer.trim().toLowerCase());
  } finally {
    prompt.close();
  }
}

async function defaultWait(): Promise<void> {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    await prompt.question("Press ENTER to open CultOS. ");
  } finally {
    prompt.close();
  }
}

function stage(index: number, label: string): void {
  console.log(`\n${pc.cyan(`[${index}/5]`)} ${pc.bold(label)}`);
}

function action(detail: string): void {
  console.log(`${pc.yellow("○")} ${detail}`);
}

function fail(detail: string, recovery?: string): false {
  console.log(`${pc.red("×")} ${detail}`);
  if (recovery) console.log(pc.dim(recovery));
  return false;
}

function paused(): false {
  console.log(pc.yellow("\nSETUP PAUSED\n"));
  console.log(pc.dim("Run cult start to continue.\n"));
  return false;
}

export async function runStart(options: StartOptions = {}): Promise<boolean> {
  if (!options.allowNonInteractive && (!process.stdin.isTTY || !process.stdout.isTTY)) {
    return fail("cult start requires an interactive terminal");
  }

  const confirm = options.confirm ?? defaultConfirm;
  const wait = options.wait ?? defaultWait;
  const launch = options.launch ?? runBbs;

  console.log(pc.bold("\n╞ CULT OS ╡  START\n"));
  console.log(pc.dim("BOOT SEQUENCE"));

  stage(1, "REPOSITORY");
  if (!exists("git")) return fail("Git is not installed", "Install Git, then run cult start again.");
  const root = captured("git", ["rev-parse", "--show-toplevel"]);
  if (root.status !== 0) return fail("Not inside a Git repository", "Open a repository, then run cult start again.");
  const remote = captured("git", ["remote", "get-url", "origin"]);
  const remoteRepository = githubRepository(remote.stdout);
  if (remote.status !== 0 || !remoteRepository) {
    return fail("The origin remote is not a GitHub repository");
  }
  console.log(`${pc.green("●")} ${remoteRepository}`);

  stage(2, "GITHUB");
  if (!exists("gh")) {
    return fail("GitHub CLI is not installed", "Install it from https://cli.github.com, then run cult start again.");
  }
  if (captured("gh", ["auth", "status"]).status !== 0) {
    action("GitHub authentication required");
    if (!await confirm("Sign in to GitHub now?")) return paused();
    if (!interactive("gh", ["auth", "login"])) return fail("GitHub authentication was not completed");
    if (captured("gh", ["auth", "status"]).status !== 0) {
      return fail("GitHub authentication was not completed");
    }
  }
  const repository = captured("gh", ["repo", "view", "--json", "nameWithOwner"]);
  if (repository.status !== 0) return fail("GitHub cannot access this repository", repository.stderr.trim());
  const repositoryResult = parsed(z.object({ nameWithOwner: z.string() }), repository.stdout);
  if (!repositoryResult) return fail("GitHub returned an unreadable repository response");
  const repositoryName = repositoryResult.nameWithOwner;
  console.log(`${pc.green("●")} ${repositoryName}`);

  stage(3, "ACP");
  if (!exists("acp")) {
    action("ACP CLI is not installed");
    if (!await confirm("Install the Virtuals ACP CLI now?")) return paused();
    if (!interactive("npm", ["install", "-g", "@virtuals-protocol/acp-cli"], 5 * 60_000)) {
      return fail("ACP CLI installation failed");
    }
    if (!exists("acp")) return fail("ACP CLI is still unavailable after installation");
  }

  let agents = captured("acp", ["agent", "list", "--json"]);
  if (agents.status !== 0) {
    if (!authenticationRequired(agents)) return fail("ACP is unavailable", agents.stderr.trim());
    action("ACP authentication required");
    if (!await confirm("Sign in to ACP now?")) return paused();
    if (!interactive("acp", ["configure"])) return fail("ACP authentication was not completed");
    agents = captured("acp", ["agent", "list", "--json"]);
  }
  if (agents.status !== 0) return fail("ACP is unavailable", agents.stderr.trim());
  const firstAgentList = parsed(agentListSchema, agents.stdout);
  if (!firstAgentList) return fail("ACP returned an unreadable agent list");
  const agentList = firstAgentList.data;
  console.log(`${pc.green("●")} connected`);

  stage(4, "AGENT");
  if (agentList.length === 0) {
    action("No ACP agent found");
    if (!await confirm("Create an ACP agent with a restricted signer?")) return paused();
    if (!interactive("acp", ["agent", "create", "--signer", "--policy", "restricted"])) {
      return fail("Agent creation was not completed");
    }
    agents = captured("acp", ["agent", "list", "--json"]);
    if (agents.status !== 0) return fail("Unable to confirm the new ACP agent");
    const createdAgentList = parsed(agentListSchema, agents.stdout);
    if (!createdAgentList || createdAgentList.data.length === 0) {
      return fail("Unable to confirm the new ACP agent");
    }
  }

  let active = captured("acp", ["agent", "whoami", "--json"]);
  if (active.status !== 0) {
    if (!interactive("acp", ["agent", "use"])) return fail("No ACP agent was selected");
    active = captured("acp", ["agent", "whoami", "--json"]);
  }
  if (active.status !== 0) return fail("Unable to read the active ACP agent");
  const agent = parsed(activeAgentSchema, active.stdout);
  if (!agent) return fail("ACP returned an unreadable active agent");
  console.log(`${pc.green("●")} ${agent.name}`);
  console.log(pc.dim(`  ${agent.walletAddress}`));

  stage(5, "SIGNER");
  let signer = captured("acp", ["agent", "signer-policy", "--agent-id", agent.id, "--json"]);
  if (signer.status !== 0) return fail("Unable to read the ACP signer", signer.stderr.trim());
  let signerReady = hasSigner(signer.stdout);
  let signatureVerified = false;
  if (signerReady) {
    const signature = verifySigner();
    if (signature.status !== 0 && !signerMissing(signature)) {
      return fail("Unable to verify the ACP signer", signature.stderr.trim());
    }
    signatureVerified = signature.status === 0;
    signerReady = signatureVerified;
  }
  if (!signerReady) {
    action("Signer approval required");
    if (!await confirm("Add a restricted ACP signer?")) return paused();
    if (!interactive("acp", [
      "agent",
      "add-signer",
      "--agent-id",
      agent.id,
      "--policy",
      "restricted"
    ])) {
      return fail("Signer approval was not completed");
    }
    signer = captured("acp", ["agent", "signer-policy", "--agent-id", agent.id, "--json"]);
    if (signer.status !== 0 || !hasSigner(signer.stdout)) {
      return fail("Unable to confirm the ACP signer");
    }
    const signature = verifySigner();
    signatureVerified = signature.status === 0;
    if (!signatureVerified) return fail("Unable to verify the ACP signer", signature.stderr.trim());
  }
  if (!signatureVerified) return fail("Unable to verify the ACP signer");
  console.log(`${pc.green("●")} ${signerPolicy(signer.stdout)}`);

  console.log(pc.green(pc.bold("\nSYSTEM READY\n")));
  console.log(`${pc.dim("REPOSITORY")}   ${repositoryName}`);
  console.log(`${pc.dim("AGENT")}        ${agent.name}`);
  console.log(`${pc.dim("NETWORK")}      Base\n`);

  await wait();
  launch();
  return true;
}
