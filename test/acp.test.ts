import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJob, currentAgent, fundJob, listAgents, requireProviderIdentity, useAgent, watchJob } from "../src/acp.js";

let directory: string;
let previousPath: string | undefined;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "cultos-acp-"));
  previousPath = process.env.PATH;
  const executable = join(directory, "acp");
  writeFileSync(
    executable,
    [
      "#!/bin/sh",
      `echo "$*" >> '${join(directory, "acp.log")}'`,
      "case \"$*\" in",
      "  *job\\ history*--job-id\\ 814*) echo '{\"jobId\":\"814\",\"chainId\":8453,\"status\":\"budget_set\",\"entries\":[{\"event\":{\"type\":\"budget.set\",\"amount\":0.01}},{\"kind\":\"message\",\"content\":\"Waiting for payment\"}]}' ; exit 0 ;;",
      "  *job\\ history*--job-id\\ 815*) echo '{\"jobId\":\"815\",\"chainId\":8453,\"status\":\"submitted\",\"entries\":[{\"event\":{\"type\":\"budget.set\",\"amount\":0.01}},{\"event\":{\"type\":\"job.submitted\",\"deliverable\":\"real-delivery-reference\"}},{\"kind\":\"message\",\"content\":\"Done\"}]}' ; exit 0 ;;",
      "  *job\\ history*--job-id\\ 816*) echo '{\"jobId\":\"816\",\"chainId\":84532,\"status\":\"open\",\"entries\":[]}' ; exit 0 ;;",
      "  *job\\ history*) echo '{\"jobId\":\"813\",\"chainId\":8453,\"status\":\"open\",\"entries\":[]}' ; exit 0 ;;",
      "  *agent\\ list*) echo '{\"data\":[{\"id\":\"buyer-id\",\"name\":\"Buyer\",\"walletAddress\":\"0x1111111111111111111111111111111111111111\"},{\"id\":\"provider-id\",\"name\":\"Provider\",\"walletAddress\":\"0x2222222222222222222222222222222222222222\"}]}' ; exit 0 ;;",
      "  *agent\\ whoami*) echo '{\"id\":\"buyer-id\",\"name\":\"Buyer\",\"walletAddress\":\"0x1111111111111111111111111111111111111111\"}' ; exit 0 ;;",
      "  *agent\\ use*) echo '{\"success\":true}' ; exit 0 ;;",
      "  *create-custom-job*) echo '{\"jobId\":813,\"chainId\":8453,\"protocol\":\"v2\"}' ; exit 0 ;;",
      "  *job\\ watch*--timeout\\ 30*) echo '{\"status\":\"budget_set\",\"availableTools\":[\"fund\"]}' ; exit 0 ;;",
      "  *job\\ watch*--timeout\\ 31*) echo 'Watching job 813...' ; exit 4 ;;",
      "  *job\\ watch*) echo '{\"status\":\"budget_set\",\"availableTools\":[\"fund\"],\"entry\":{\"event\":{\"amount\":\"1.00\"}}}' ; exit 0 ;;",
      "  *client\\ fund*) echo '{\"error\":\"Insufficient balance\",\"code\":\"API_ERROR\",\"recovery\":\"Top up your wallet\"}' >&2 ; exit 1 ;;",
      "esac",
      "echo '{\"error\":\"unexpected command\"}' >&2",
      "exit 1"
    ].join("\n"),
    "utf8"
  );
  chmodSync(executable, 0o755);
  process.env.PATH = `${directory}${delimiter}${previousPath ?? ""}`;
});

afterEach(() => {
  process.env.PATH = previousPath;
  rmSync(directory, { recursive: true, force: true });
});

describe("ACP adapter", () => {
  it("creates a custom job from a work contract", () => {
    const job = createJob({
      provider: "0x1234",
      chainId: 8453,
      expiry: 3600,
      contract: {
        kind: "cultos.github.issue.v1",
        repository: "https://github.com/thecultos/example",
        issue: "https://github.com/thecultos/example/issues/42",
        baseRef: "main",
        title: "Fix wallet balance parsing",
        acceptanceCriteria: ["Tests pass"],
        delivery: { type: "github.pull_request" }
      }
    });

    expect(job).toEqual({ jobId: "813", chainId: 8453, protocol: "v2" });
  });

  it("reads the quote from a watched job", () => {
    const job = watchJob("813");

    expect(job.status).toBe("budget_set");
    expect(job.budget).toBe("1.00");
    expect(job.availableTools).toEqual(["fund"]);
  });

  it("recovers an existing quote even when a message followed it", () => {
    const job = watchJob("814", 1);
    expect(job.status).toBe("budget_set");
    expect(job.budget).toBe("0.01");
  });

  it("recovers a submitted delivery and earlier quote across sessions", () => {
    const job = watchJob("815", 1);
    expect(job.status).toBe("submitted");
    expect(job.budget).toBe("0.01");
    expect(job.deliverable).toBe("real-delivery-reference");
  });

  it("rejects history from a different chain", () => {
    expect(() => watchJob("814", 1, 84532)).toThrow("different job or chain");
  });

  it("watches the chain the job is recorded on", () => {
    watchJob("816", undefined, 84532);
    const invocations = readFileSync(join(directory, "acp.log"), "utf8");
    const watch = invocations.split("\n").find((line) => line.startsWith("job watch"));

    expect(watch).toBeDefined();
    expect(watch).toContain("--chain-id 84532");
  });

  it("passes an optional watch timeout", () => {
    const job = watchJob("813", 30);

    expect(job.status).toBe("budget_set");
  });

  it("reports ACP watch timeouts clearly", () => {
    expect(() => watchJob("813", 31)).toThrow("No ACP update within 31 seconds");
  });

  it("formats structured ACP errors", () => {
    expect(() => fundJob("813", 8453, "1.00")).toThrow(
      "Insufficient balance. Top up your wallet"
    );
  });

  it("lists, reads and switches ACP agents", () => {
    expect(listAgents().map(agent => agent.id)).toEqual(["buyer-id", "provider-id"]);
    expect(currentAgent().walletAddress).toBe("0x1111111111111111111111111111111111111111");
    expect(useAgent("provider-id").id).toBe("buyer-id");
  });

  it("accepts exact agent names case-insensitively and refuses unknown names", () => {
    expect(useAgent("buyer").id).toBe("buyer-id");
    expect(() => useAgent("unknown")).toThrow("Agent not found");
  });

  it("refuses a provider action from the wrong active wallet", () => {
    expect(() => requireProviderIdentity("0x2222222222222222222222222222222222222222")).toThrow(
      "Run cult agent use provider-id"
    );
    expect(requireProviderIdentity("0x1111111111111111111111111111111111111111").id).toBe("buyer-id");
  });
});
