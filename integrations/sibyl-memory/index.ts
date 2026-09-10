import { existsSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";
import { evaluateDelivery } from "../../src/verify.js";
import type { CultJob } from "../../src/state.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const dataDirectory = join(root, ".cultos", "sibyl-memory");
const database = join(dataDirectory, "memory.db");
const credentials = join(dataDirectory, "credentials.json");
const localServer = join(root, ".cultos", "sibyl", "bin", "sibyl-memory-mcp");
const server = process.env.SIBYL_MEMORY_MCP || (existsSync(localServer) ? localServer : "sibyl-memory-mcp");
const category = "cultos.repository";
const repository = "cultosagent/review-lab";

const outcomeSchema = z.object({
  commit: z.string().regex(/^[0-9a-f]{40}$/),
  verification: z.enum(["approved", "rejected"]),
  failures: z.array(z.string().max(240)).max(20),
  checks: z.array(z.object({ name: z.string().max(120), state: z.string().max(80), bucket: z.string().max(40) })).max(50),
});

const memorySchema = z.object({
  schema: z.literal("cultos.sibyl.repository-memory.v1"),
  repository: z.literal(repository),
  source: z.literal("cultos.verify"),
  history: z.array(outcomeSchema).max(20),
});

const fixtureSchema = z.object({
  commit: z.string().regex(/^[0-9a-f]{40}$/),
  pullRequest: z.object({
    number: z.number().int().positive(),
    url: z.string().url(),
    headSha: z.string().regex(/^[0-9a-f]{40}$/),
    baseRef: z.string().min(1),
    state: z.enum(["OPEN", "MERGED", "CLOSED"]),
    platform: z.literal("github"),
  }),
  checks: z.array(z.object({ name: z.string(), state: z.string(), bucket: z.enum(["pass", "fail", "pending", "neutral", "skipping"]) })),
});

type Memory = z.infer<typeof memorySchema>;
type Fixture = z.infer<typeof fixtureSchema>;

function fixtureJob(fixture: Fixture): CultJob {
  return {
    issueNumber: 1,
    repository,
    contract: {
      kind: "cultos.github.issue.v1",
      repository: `https://github.com/${repository}`,
      issue: `https://github.com/${repository}/issues/1`,
      baseRef: "main",
      title: "Restore required CI verification",
      acceptanceCriteria: ["Required CI checks pass"],
      delivery: { type: "github.pull_request" },
    },
    provider: "0x0000000000000000000000000000000000000001",
    jobId: "sibyl-memory",
    chainId: 8453,
    status: "submitted",
    delivery: {
      kind: "cultos.github.pull-request.v1",
      url: fixture.pullRequest.url,
      headSha: fixture.commit,
    },
    createdAt: "2026-09-10T00:00:00.000Z",
    updatedAt: "2026-09-10T00:00:00.000Z",
  };
}

async function loadFixture(name: "failed" | "resolved"): Promise<Fixture> {
  const raw = await readFile(join(root, "integrations", "sibyl-memory", "fixtures", `${name}.json`), "utf8");
  return fixtureSchema.parse(JSON.parse(raw));
}

function textResult(result: unknown): unknown {
  if (!result || typeof result !== "object") throw new Error("Sibyl returned an invalid result");
  const envelope = result as { isError?: unknown; content?: unknown };
  if (envelope.isError) throw new Error("Sibyl rejected the memory operation");
  if (!Array.isArray(envelope.content)) throw new Error("Sibyl returned no structured result");
  const text = envelope.content.find((item): item is { type: "text"; text: string } => (
    Boolean(item) && typeof item === "object" && (item as { type?: unknown }).type === "text" && typeof (item as { text?: unknown }).text === "string"
  ));
  if (!text) throw new Error("Sibyl returned no structured result");
  return JSON.parse(text.text);
}

async function connect(): Promise<Client> {
  const client = new Client({ name: "cultos-sibyl-memory", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: server,
    env: {
      ...process.env,
      SIBYL_MEMORY_DB: database,
      SIBYL_CREDENTIALS: credentials,
    },
    stderr: "pipe",
  });
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Sibyl connection timed out")), 4_000));
  await Promise.race([client.connect(transport), timeout]);
  return client;
}

async function recall(client: Client): Promise<Memory> {
  const result = textResult(await client.callTool({ name: "memory_recall", arguments: { category, name: repository } })) as { entity?: { body?: unknown } };
  return memorySchema.parse(result.entity?.body);
}

async function remember(client: Client, memory: Memory): Promise<void> {
  textResult(await client.callTool({ name: "memory_remember", arguments: { category, name: repository, body: memory } }));
}

function outcome(fixture: Fixture) {
  const result = evaluateDelivery(fixtureJob(fixture), fixture.pullRequest, fixture.checks);
  return outcomeSchema.parse({
    commit: fixture.commit,
    verification: result.passed ? "approved" : "rejected",
    failures: result.failures,
    checks: result.checks,
  });
}

function printOutcome(label: string, item: z.infer<typeof outcomeSchema>) {
  console.log(`\n${label}\n`);
  console.log(`Repository    ${repository}`);
  console.log(`Commit        ${item.commit.slice(0, 12)}`);
  console.log(`Verification  ${item.verification.toUpperCase()}`);
  for (const failure of item.failures) console.log(`Finding       ${failure}`);
}

async function status() {
  const client = await connect();
  try {
    const tools = await client.listTools();
    const names = new Set(tools.tools.map(tool => tool.name));
    for (const required of ["memory_remember", "memory_recall", "memory_list"]) {
      if (!names.has(required)) throw new Error(`Sibyl tool unavailable: ${required}`);
    }
    console.log("\nCULT OS // SIBYL MEMORY\n");
    console.log("Cult OS verification   READY");
    console.log("Sibyl persistence      READY");
    console.log(`Database               ${database}`);
    console.log("\nRecord in this session:");
    console.log("npm run sibyl:memory:record");
    console.log("\nRecall from a fresh session:");
    console.log("npm run sibyl:memory:recall\n");
  } finally {
    await client.close();
  }
}

async function record() {
  const failed = outcome(await loadFixture("failed"));
  if (failed.verification !== "rejected") throw new Error("Expected the first delivery to fail verification");
  const client = await connect();
  try {
    await remember(client, { schema: "cultos.sibyl.repository-memory.v1", repository, source: "cultos.verify", history: [failed] });
    printOutcome("CULT OS // REPOSITORY MEMORY", failed);
    console.log("\nSIBYL         RECORDED\n");
  } finally {
    await client.close();
  }
}

async function recallAndResolve() {
  const client = await connect();
  try {
    const memory = await recall(client);
    const previous = memory.history.at(-1);
    if (!previous || previous.verification !== "rejected") throw new Error("No rejected repository outcome was recalled");
    printOutcome("CULT OS // PREVIOUS OUTCOME", previous);
    const resolved = outcome(await loadFixture("resolved"));
    if (resolved.verification !== "approved") throw new Error("Expected the corrected delivery to pass verification");
    await remember(client, { ...memory, history: [...memory.history, resolved] });
    printOutcome("CURRENT DELIVERY", resolved);
    console.log("\nSIBYL         UPDATED\n");
  } finally {
    await client.close();
  }
}

async function history() {
  const client = await connect();
  try {
    const memory = await recall(client);
    console.log("\nCULT OS // REPOSITORY HISTORY\n");
    for (const item of memory.history) {
      console.log(`${item.commit.slice(0, 12)}  ${item.verification.padEnd(8)}  ${item.failures[0] || "required checks passed"}`);
    }
    console.log();
  } finally {
    await client.close();
  }
}

function reset() {
  for (const suffix of ["", "-shm", "-wal"]) rmSync(`${database}${suffix}`, { force: true });
  console.log("\nCULT OS // SIBYL MEMORY\n\nRepository memory reset.\n");
}

async function main() {
  const command = process.argv[2] || "status";
  if (command === "status") await status();
  else if (command === "record") await record();
  else if (command === "recall") await recallAndResolve();
  else if (command === "history") await history();
  else if (command === "reset") reset();
  else throw new Error(`Unknown Sibyl Memory command: ${command}`);
}

main().catch(error => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nSibyl Memory unavailable: ${message}\n`);
  process.exitCode = 1;
});
