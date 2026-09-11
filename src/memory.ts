import { existsSync, lstatSync, mkdirSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";
import { z } from "zod";
import type { RepositoryPlatform } from "./contract.js";
import type { CultJob } from "./state.js";
import type { ReviewVerificationResult, VerificationResult } from "./verify.js";

const CATEGORY = "cultos.repository";
const HISTORY_LIMIT = 20;
const REQUEST_TIMEOUT = 3_000;
const SIBYL_MCP_VERSION = "0.2.1";
const safeText = (maximum: number) => z.string().min(1).max(maximum).refine(value => !/[\u0000-\u001f\u007f-\u009f]/.test(value), "Control characters are not allowed");
const canonicalRepositorySchema = safeText(200).regex(/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i);

const checkSchema = z.object({
  name: safeText(120),
  state: safeText(80),
  bucket: safeText(40)
}).strict();

export const repositoryOutcomeSchema = z.object({
  platform: z.enum(["github", "gitlawb"]),
  issue: safeText(200),
  pullRequest: z.string().url().max(500),
  pinnedCommit: z.string().regex(/^[0-9a-f]{7,64}$/i),
  verification: z.enum(["verified", "rejected"]),
  checks: z.array(checkSchema).max(50),
  failures: z.array(safeText(240)).max(20),
  timestamp: z.string().datetime()
}).strict();

export const repositoryMemorySchema = z.object({
  schema: z.literal("cultos.sibyl.repository-memory.v1"),
  repository: canonicalRepositorySchema,
  platform: z.enum(["github", "gitlawb"]),
  history: z.array(repositoryOutcomeSchema).max(HISTORY_LIMIT)
}).strict();

export type RepositoryOutcome = z.infer<typeof repositoryOutcomeSchema>;
export type RepositoryMemory = z.infer<typeof repositoryMemorySchema>;

export interface MemoryBackend {
  status(): Promise<string[]>;
  recall(category: string, name: string): Promise<unknown | undefined>;
  remember(category: string, name: string, body: unknown): Promise<void>;
}

type McpClient = {
  listTools(params?: Record<string, never>, options?: { timeout?: number }): Promise<{ tools: Array<{ name: string }> }>;
  callTool(params: { name: string; arguments: Record<string, unknown> }, resultSchema?: unknown, options?: { timeout?: number }): Promise<unknown>;
  close(): Promise<void>;
};

class NotFoundError extends Error {}

function repositoryName(repository: string): string {
  return canonicalRepositorySchema.parse(repository.trim().replace(/^https?:\/\/(?:www\.)?(?:github\.com|gitlawb\.com)\//, "").replace(/\/$/, "").toLowerCase());
}

function entityName(repository: string, platform: RepositoryPlatform): string {
  return `${platform}:${repositoryName(repository)}`;
}

function resultText(result: unknown): string {
  if (!result || typeof result !== "object") throw new Error("Sibyl returned an invalid response");
  const envelope = result as { isError?: unknown; content?: unknown };
  if (!Array.isArray(envelope.content)) throw new Error("Sibyl returned no response body");
  const text = envelope.content.find((item): item is { type: "text"; text: string } => (
    Boolean(item) && typeof item === "object" && (item as { type?: unknown }).type === "text" && typeof (item as { text?: unknown }).text === "string"
  ));
  if (!text) throw new Error("Sibyl returned no response body");
  if (envelope.isError) {
    if (text.text.includes("NOT_FOUND")) throw new NotFoundError("Repository memory not found");
    throw new Error("Sibyl rejected the memory operation");
  }
  return text.text;
}

function resultJson(result: unknown): unknown {
  try {
    return JSON.parse(resultText(result));
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    throw new Error("Sibyl returned malformed data");
  }
}

function repositoryRoot(): string {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return process.cwd();
  }
}

function localServerCommand(root = repositoryRoot()): string {
  return join(root, ".cultos", "sibyl", "bin", "sibyl-memory-mcp");
}

function serverCommand(): string {
  const configured = process.env.SIBYL_MEMORY_MCP?.trim();
  if (configured) return configured;
  const local = localServerCommand();
  return existsSync(local) ? local : "sibyl-memory-mcp";
}

function checkedRun(command: string, args: string[]): string {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = result.stderr.trim().split("\n").at(-1);
    throw new Error(detail || `${command} exited with status ${result.status ?? "unknown"}`);
  }
  return `${result.stdout}\n${result.stderr}`.trim();
}

function pythonCommand(): string {
  for (const command of ["python3", "python"]) {
    try {
      const version = checkedRun(command, ["--version"]);
      const match = version.match(/Python\s+(\d+)\.(\d+)/i);
      if (match && (Number(match[1]) > 3 || (Number(match[1]) === 3 && Number(match[2]) >= 10))) return command;
    } catch {}
  }
  throw new Error("Python 3.10 or newer is required");
}

function rejectSymlink(path: string): void {
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) {
    throw new Error(`Refusing symbolic-link setup path: ${path}`);
  }
}

export function installSibylMemory(): string {
  if (process.platform === "win32") throw new Error("Sibyl Memory requires Linux, macOS or WSL2");
  if (process.env.SIBYL_MEMORY_MCP?.trim()) {
    throw new Error("SIBYL_MEMORY_MCP is configured but unavailable; fix or unset it before setup");
  }
  const root = repositoryRoot();
  const cultosDirectory = join(root, ".cultos");
  const environment = join(cultosDirectory, "sibyl");
  rejectSymlink(cultosDirectory);
  rejectSymlink(environment);
  mkdirSync(cultosDirectory, { recursive: true, mode: 0o700 });
  const python = pythonCommand();
  checkedRun(python, ["-m", "venv", environment]);
  const environmentPython = join(environment, "bin", "python");
  checkedRun(environmentPython, [
    "-m", "pip", "install", "--disable-pip-version-check", "--no-input", `sibyl-memory-mcp==${SIBYL_MCP_VERSION}`
  ]);
  const installed = localServerCommand(root);
  if (!existsSync(installed)) throw new Error("Sibyl MCP executable was not installed");
  return installed;
}

async function connect(): Promise<McpClient> {
  const [{ Client }, { StdioClientTransport, getDefaultEnvironment }] = await Promise.all([
    import("@modelcontextprotocol/sdk/client/index.js"),
    import("@modelcontextprotocol/sdk/client/stdio.js")
  ]);
  const client = new Client({ name: "cultos-cli", version: "1.0.0" });
  const env = getDefaultEnvironment();
  for (const key of ["SIBYL_MEMORY_DB", "SIBYL_CREDENTIALS"]) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  const transport = new StdioClientTransport({ command: serverCommand(), env, stderr: "pipe" });
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      client.connect(transport),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Sibyl connection timed out")), REQUEST_TIMEOUT);
      })
    ]);
  } catch (error) {
    await client.close().catch(() => undefined);
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
  return client;
}

async function useClient<T>(operation: (client: McpClient) => Promise<T>): Promise<T> {
  const client = await connect();
  try {
    return await operation(client);
  } finally {
    await client.close();
  }
}

export function createMcpMemoryBackend(): MemoryBackend {
  return {
    async status() {
      return useClient(async client => (await client.listTools(undefined, { timeout: REQUEST_TIMEOUT })).tools.map(tool => tool.name));
    },
    async recall(category, name) {
      return useClient(async client => {
        try {
          const payload = resultJson(await client.callTool({
            name: "memory_recall",
            arguments: { category, name }
          }, undefined, { timeout: REQUEST_TIMEOUT })) as { entity?: { body?: unknown } };
          return payload.entity?.body;
        } catch (error) {
          if (error instanceof NotFoundError) return undefined;
          throw error;
        }
      });
    },
    async remember(category, name, body) {
      await useClient(async client => {
        resultJson(await client.callTool({
          name: "memory_remember",
          arguments: { category, name, body }
        }, undefined, { timeout: REQUEST_TIMEOUT }));
      });
    }
  };
}

export function verificationOutcome(
  job: CultJob,
  result: VerificationResult | ReviewVerificationResult,
  now = new Date()
): RepositoryOutcome {
  const platform: RepositoryPlatform = job.contract.kind === "cultos.gitlawb.issue.v1" ? "gitlawb" : "github";
  return repositoryOutcomeSchema.parse({
    platform,
    issue: String(job.issueNumber),
    pullRequest: result.url,
    pinnedCommit: result.headSha,
    verification: result.passed ? "verified" : "rejected",
    checks: "checks" in result ? result.checks.map(({ name, state, bucket }) => ({ name, state, bucket })) : [],
    failures: result.failures,
    timestamp: now.toISOString()
  });
}

export function createRepositoryMemory(backend: MemoryBackend = createMcpMemoryBackend()) {
  return {
    async status(): Promise<void> {
      const tools = new Set(await backend.status());
      for (const required of ["memory_recall", "memory_remember"]) {
        if (!tools.has(required)) throw new Error(`Sibyl tool unavailable: ${required}`);
      }
    },
    async recall(repository: string, platform: RepositoryPlatform): Promise<RepositoryMemory | undefined> {
      const canonical = repositoryName(repository);
      const body = await backend.recall(CATEGORY, entityName(canonical, platform));
      if (body === undefined) return undefined;
      const memory = repositoryMemorySchema.parse(body);
      if (memory.repository !== canonical || memory.platform !== platform) {
        throw new Error("Sibyl repository identity mismatch");
      }
      return memory;
    },
    async record(job: CultJob, result: VerificationResult | ReviewVerificationResult): Promise<RepositoryMemory> {
      const platform: RepositoryPlatform = job.contract.kind === "cultos.gitlawb.issue.v1" ? "gitlawb" : "github";
      const canonical = repositoryName(job.repository);
      const name = entityName(canonical, platform);
      const existingBody = await backend.recall(CATEGORY, name);
      const existing = existingBody === undefined
        ? { schema: "cultos.sibyl.repository-memory.v1" as const, repository: canonical, platform, history: [] }
        : repositoryMemorySchema.parse(existingBody);
      if (existing.repository !== canonical || existing.platform !== platform) {
        throw new Error("Sibyl repository identity mismatch");
      }
      const next = verificationOutcome(job, result);
      const key = `${next.issue}:${next.pullRequest}:${next.pinnedCommit}:${next.verification}`;
      const history = existing.history.filter(item => `${item.issue}:${item.pullRequest}:${item.pinnedCommit}:${item.verification}` !== key);
      const memory = repositoryMemorySchema.parse({ ...existing, history: [...history, next].slice(-HISTORY_LIMIT) });
      await backend.remember(CATEGORY, name, memory);
      return memory;
    }
  };
}
