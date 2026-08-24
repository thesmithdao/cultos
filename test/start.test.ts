import { chmodSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { runStart } from "../src/start.js";

let directory: string;
let previousPath: string | undefined;

function executable(name: string, body: string): void {
  const path = join(directory, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`, "utf8");
  chmodSync(path, 0o755);
}

function installGit(): void {
  executable("git", [
    "case \"$*\" in",
    "  --version) echo 'git version 2.0' ;;",
    "  'rev-parse --show-toplevel') echo '/tmp/example' ;;",
    "  'remote get-url origin') echo 'https://github.com/example/repo.git' ;;",
    "  *) exit 1 ;;",
    "esac"
  ].join("\n"));
}

function installGitHub(authenticated = true): void {
  const authState = join(directory, "github-authenticated");
  if (authenticated) writeFileSync(authState, "ready", "utf8");
  executable("gh", [
    "case \"$*\" in",
    "  --version) echo 'gh version 2.0' ;;",
    `  'auth status') [ -f '${authState}' ] ;;`,
    `  'auth login') : > '${authState}' ;;`,
    "  'repo view --json nameWithOwner') echo '{\"nameWithOwner\":\"example/repo\"}' ;;",
    "  *) exit 1 ;;",
    "esac"
  ].join("\n"));
}

function installAcp(options: { agents?: boolean; signer?: boolean; authenticated?: boolean; active?: boolean } = {}): void {
  const agents = options.agents ?? true;
  const signer = options.signer ?? true;
  const authenticated = options.authenticated ?? true;
  const active = options.active ?? true;
  const agentState = join(directory, "agent-ready");
  const signerState = join(directory, "signer-ready");
  const authState = join(directory, "acp-authenticated");
  const activeState = join(directory, "agent-active");
  if (agents) writeFileSync(agentState, "ready", "utf8");
  if (signer) writeFileSync(signerState, "ready", "utf8");
  if (authenticated) writeFileSync(authState, "ready", "utf8");
  if (active) writeFileSync(activeState, "ready", "utf8");
  executable("acp", [
    "case \"$*\" in",
    "  --version) echo 'acp 3.0' ;;",
    `  'agent list --json') if [ ! -f '${authState}' ]; then echo 'NOT_AUTHENTICATED: Run acp configure' >&2; exit 1; elif [ -f '${agentState}' ]; then echo '{\"data\":[{\"id\":\"agent-1\",\"name\":\"Example Agent\",\"walletAddress\":\"0x1234\"}]}' ; else echo '{\"data\":[]}' ; fi ;;`,
    `  configure) : > '${authState}' ;;`,
    `  'agent create --signer --policy restricted') : > '${agentState}'; : > '${signerState}'; : > '${activeState}' ;;`,
    `  'agent use') : > '${activeState}' ;;`,
    `  'agent whoami --json') if [ -f '${activeState}' ]; then echo '{\"id\":\"agent-1\",\"name\":\"Example Agent\",\"walletAddress\":\"0x1234\"}'; else exit 1; fi ;;`,
    `  'agent signer-policy --agent-id agent-1 --json') if [ -f '${signerState}' ]; then echo '{\"matched\":true}' ; else echo '{\"matched\":false}' ; fi ;;`,
    `  'agent add-signer --agent-id agent-1 --policy restricted') : > '${signerState}' ;;`,
    `  'wallet sign-message --message CultOS readiness check --chain-id 8453 --json') if [ -f '${signerState}' ]; then echo '{\"signature\":\"0x1234\"}'; else echo 'NO_SIGNER' >&2; exit 1; fi ;;`,
    "  *) exit 1 ;;",
    "esac"
  ].join("\n"));
}

async function start(confirm = vi.fn(async () => true)): Promise<{ ready: boolean; launch: ReturnType<typeof vi.fn> }> {
  const launch = vi.fn();
  const ready = await runStart({
    confirm,
    wait: async () => undefined,
    launch,
    allowNonInteractive: true
  });
  return { ready, launch };
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "cultos-start-"));
  previousPath = process.env.PATH;
  process.env.PATH = directory;
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  process.env.PATH = previousPath;
  vi.restoreAllMocks();
  rmSync(directory, { recursive: true, force: true });
});

describe("cult start", () => {
  test("opens CultOS when the environment is ready", async () => {
    installGit();
    installGitHub();
    installAcp();

    const result = await start();

    expect(result.ready).toBe(true);
    expect(result.launch).toHaveBeenCalledOnce();
  });

  test("stops when GitHub CLI is missing", async () => {
    installGit();

    const result = await start();

    expect(result.ready).toBe(false);
    expect(result.launch).not.toHaveBeenCalled();
  });

  test("runs GitHub authentication when required", async () => {
    installGit();
    installGitHub(false);
    installAcp();

    const confirm = vi.fn(async () => true);
    const result = await start(confirm);

    expect(result.ready).toBe(true);
    expect(confirm).toHaveBeenCalledWith("Sign in to GitHub now?");
  });

  test("creates an agent when none exists", async () => {
    installGit();
    installGitHub();
    installAcp({ agents: false, signer: false });

    const confirm = vi.fn(async () => true);
    const result = await start(confirm);

    expect(result.ready).toBe(true);
    expect(confirm).toHaveBeenCalledWith("Create an ACP agent with a restricted signer?");
  });

  test("runs ACP authentication when required", async () => {
    installGit();
    installGitHub();
    installAcp({ authenticated: false });

    const confirm = vi.fn(async () => true);
    const result = await start(confirm);

    expect(result.ready).toBe(true);
    expect(confirm).toHaveBeenCalledWith("Sign in to ACP now?");
  });

  test("installs the ACP CLI when approved", async () => {
    installGit();
    installGitHub();
    installAcp();
    const acp = join(directory, "acp");
    const template = join(directory, "acp-template");
    renameSync(acp, template);
    executable("npm", [
      "case \"$*\" in",
      `  'install -g @virtuals-protocol/acp-cli') /bin/cp '${template}' '${acp}'; /bin/chmod 755 '${acp}' ;;`,
      "  *) exit 1 ;;",
      "esac"
    ].join("\n"));
    const confirm = vi.fn(async () => true);

    const result = await start(confirm);

    expect(result.ready).toBe(true);
    expect(confirm).toHaveBeenCalledWith("Install the Virtuals ACP CLI now?");
  });

  test("selects an existing agent when none is active", async () => {
    installGit();
    installGitHub();
    installAcp({ active: false });

    const result = await start();

    expect(result.ready).toBe(true);
  });

  test("does not treat an ACP outage as missing authentication", async () => {
    installGit();
    installGitHub();
    executable("acp", [
      "case \"$*\" in",
      "  --version) exit 0 ;;",
      "  'agent list --json') echo 'Service unavailable' >&2; exit 1 ;;",
      "esac"
    ].join("\n"));
    const confirm = vi.fn(async () => true);

    const result = await start(confirm);

    expect(result.ready).toBe(false);
    expect(confirm).not.toHaveBeenCalledWith("Sign in to ACP now?");
  });

  test("adds a restricted signer when missing", async () => {
    installGit();
    installGitHub();
    installAcp({ signer: false });

    const confirm = vi.fn(async () => true);
    const result = await start(confirm);

    expect(result.ready).toBe(true);
    expect(confirm).toHaveBeenCalledWith("Add a restricted ACP signer?");
  });

  test("adds a signer when remote signers do not match this CLI", async () => {
    installGit();
    installGitHub();
    installAcp();
    const acp = join(directory, "acp");
    executable("acp", [
      "case \"$*\" in",
      "  --version) exit 0 ;;",
      "  'agent list --json') echo '{\"data\":[{\"id\":\"agent-1\",\"name\":\"Example Agent\",\"walletAddress\":\"0x1234\"}]}' ;;",
      "  'agent whoami --json') echo '{\"id\":\"agent-1\",\"name\":\"Example Agent\",\"walletAddress\":\"0x1234\"}' ;;",
      `  'agent signer-policy --agent-id agent-1 --json') if [ -f '${acp}.added' ]; then echo '{\"signerId\":\"local\"}'; else echo '{\"matched\":false,\"signers\":[{\"signerId\":\"remote\"}]}' ; fi ;;`,
      `  'agent add-signer --agent-id agent-1 --policy restricted') : > '${acp}.added' ;;`,
      `  'wallet sign-message --message CultOS readiness check --chain-id 8453 --json') if [ -f '${acp}.added' ]; then echo '{\"signature\":\"0x1234\"}'; else echo 'NO_SIGNER' >&2; exit 1; fi ;;`,
      "  *) exit 1 ;;",
      "esac"
    ].join("\n"));
    const confirm = vi.fn(async () => true);

    const result = await start(confirm);

    expect(result.ready).toBe(true);
    expect(confirm).toHaveBeenCalledWith("Add a restricted ACP signer?");
  });

  test("proves the signer key is usable before reporting ready", async () => {
    installGit();
    installGitHub();
    installAcp();
    const acp = join(directory, "acp");
    executable("acp", [
      "case \"$*\" in",
      "  --version) exit 0 ;;",
      "  'agent list --json') echo '{\"data\":[{\"id\":\"agent-1\",\"name\":\"Example Agent\",\"walletAddress\":\"0x1234\"}]}' ;;",
      "  'agent whoami --json') echo '{\"id\":\"agent-1\",\"name\":\"Example Agent\",\"walletAddress\":\"0x1234\"}' ;;",
      "  'agent signer-policy --agent-id agent-1 --json') echo '{\"signerId\":\"remote\",\"policy\":\"ACP_ONLY\"}' ;;",
      `  'agent add-signer --agent-id agent-1 --policy restricted') : > '${acp}.added' ;;`,
      `  'wallet sign-message --message CultOS readiness check --chain-id 8453 --json') if [ -f '${acp}.added' ]; then echo '{\"signature\":\"0x1234\"}'; else echo 'NO_SIGNER' >&2; exit 1; fi ;;`,
      "  *) exit 1 ;;",
      "esac"
    ].join("\n"));
    const confirm = vi.fn(async () => true);

    const result = await start(confirm);

    expect(result.ready).toBe(true);
    expect(confirm).toHaveBeenCalledWith("Add a restricted ACP signer?");
  });

  test("pauses without launching when the user declines", async () => {
    installGit();
    installGitHub();
    installAcp({ signer: false });

    const result = await start(vi.fn(async () => false));

    expect(result.ready).toBe(false);
    expect(result.launch).not.toHaveBeenCalled();
  });
});
