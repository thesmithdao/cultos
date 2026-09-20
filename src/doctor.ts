import { spawnSync } from "node:child_process";
import pc from "picocolors";
import { z } from "zod";
import { commandExists, githubIsAuthenticated } from "./github.js";
import { parseGitLawbRemote } from "./gitlawb.js";

// Matches agentValue in acp.ts: an agent name is printed to the terminal, so
// escape sequences are rejected rather than displayed.
const agentText = z.string().min(1).max(200)
  .refine((value) => !/[\u0000-\u001f\u007f-\u009f]/.test(value));
const agentSchema = z.object({
  name: agentText,
  walletAddress: agentText
}).passthrough();

const signerSchema = z.object({
  matched: z.boolean().optional(),
  signerId: z.string().optional(),
  signers: z.array(z.unknown()).optional()
}).passthrough();

/**
 * Read a JSON response without letting a malformed one end the run.
 *
 * `cult doctor` is what a maintainer reaches for when something is already
 * broken, so an ACP CLI that prints a warning line before its JSON, or no
 * JSON at all, has to surface as a failed check rather than a stack trace.
 */
function parsed<T>(schema: z.ZodType<T>, value: string): T | undefined {
  try {
    return schema.parse(JSON.parse(value.trim()));
  } catch {
    return undefined;
  }
}

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

function repositoryCheck(): Check {
  const root = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8"
  });

  if (root.status !== 0) {
    return {
      name: "Repository",
      ok: false,
      detail: "not inside a Git repository"
    };
  }

  const remote = spawnSync("git", ["remote", "get-url", "origin"], {
    encoding: "utf8"
  });
  const value = remote.stdout.trim();
  const githubRepository = value.match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/)?.[1];
  const gitlawbRepository = parseGitLawbRemote(value);

  return {
    name: "Repository",
    ok: true,
    detail: githubRepository ?? (gitlawbRepository
      ? `${gitlawbRepository.owner}/${gitlawbRepository.repository}`
      : "unsupported remote")
  };
}

function acpChecks(hasAcp: boolean): Check[] {
  if (!hasAcp) {
    return [
      { name: "ACP CLI", ok: false, detail: "not installed" },
      { name: "Agent", ok: false, detail: "unavailable" },
      { name: "Signer", ok: false, detail: "unavailable" }
    ];
  }

  const identity = spawnSync("acp", ["agent", "whoami", "--json"], {
    encoding: "utf8"
  });
  if (identity.status !== 0) {
    return [
      { name: "ACP CLI", ok: true, detail: "installed" },
      { name: "Agent", ok: false, detail: "authentication required" },
      { name: "Signer", ok: false, detail: "unavailable" }
    ];
  }

  const agent = parsed(agentSchema, identity.stdout);
  if (!agent) {
    return [
      { name: "ACP CLI", ok: true, detail: "installed" },
      { name: "Agent", ok: false, detail: "unreadable response" },
      { name: "Signer", ok: false, detail: "unavailable" }
    ];
  }

  const signer = spawnSync("acp", ["agent", "signer-policy", "--json"], {
    encoding: "utf8"
  });
  const signerState = signer.status === 0 ? parsed(signerSchema, signer.stdout) : undefined;
  const hasSigner = Boolean(signerState?.signerId)
    || signerState?.matched === true
    || (signerState?.signers?.length ?? 0) > 0;
  const signerDetail = signer.status !== 0
    ? "unavailable"
    : signerState === undefined
      ? "unreadable response"
      : hasSigner ? "ready" : "approval required";
  const wallet = agent.walletAddress.length > 10
    ? `${agent.walletAddress.slice(0, 6)}…${agent.walletAddress.slice(-4)}`
    : agent.walletAddress;

  return [
    { name: "ACP CLI", ok: true, detail: "installed" },
    { name: "Agent", ok: true, detail: `${agent.name} ${wallet}` },
    { name: "Signer", ok: hasSigner, detail: signerDetail }
  ];
}

export function runDoctor(): void {
  const remote = spawnSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" });
  const usesGitLawb = Boolean(parseGitLawbRemote(remote.stdout ?? ""));
  const hasGitHub = commandExists("gh");
  const hasGitLawb = commandExists("gl");
  const hasGitLawbIdentity = hasGitLawb && spawnSync("gl", ["identity", "show"], { stdio: "ignore" }).status === 0;
  const hasAcp = commandExists("acp");
  const hasGitHubAuth = hasGitHub && githubIsAuthenticated();
  const checks: Check[] = [
    { name: "Node.js", ok: true, detail: process.version },
    { name: "Git", ok: commandExists("git"), detail: "installed" },
    usesGitLawb
      ? {
          name: "GitLawb CLI",
          ok: hasGitLawbIdentity,
          detail: hasGitLawbIdentity ? "identity ready" : hasGitLawb ? "identity required" : "not installed"
        }
      : {
          name: "GitHub CLI",
          ok: hasGitHubAuth,
          detail: hasGitHubAuth ? "authenticated" : hasGitHub ? "authentication required" : "not installed"
        },
    ...acpChecks(hasAcp),
    repositoryCheck()
  ];

  console.log(pc.bold("\nCULT OS // SYSTEM CHECK\n"));

  for (const check of checks) {
    const marker = check.ok ? pc.green("●") : pc.yellow("○");
    const status = check.ok ? pc.dim(check.detail) : pc.yellow(check.detail);
    console.log(`${marker} ${check.name.padEnd(14)} ${status}`);
  }

  const unresolved = checks.filter((check) => !check.ok).length;
  console.log(
    unresolved === 0
      ? pc.green("\nSystem ready.\n")
      : pc.yellow(`\n${unresolved} ${unresolved === 1 ? "action" : "actions"} required before live jobs.\n`)
  );
}
