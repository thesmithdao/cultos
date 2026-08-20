import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJob, watchJob } from "../src/acp.js";

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
      "case \"$*\" in",
      "  *create-custom-job*) echo '{\"jobId\":813,\"chainId\":8453,\"protocol\":\"v2\"}' ; exit 0 ;;",
      "  *job\\ watch*) echo '{\"status\":\"budget_set\",\"availableTools\":[\"fund\"],\"entry\":{\"event\":{\"amount\":\"1.00\"}}}' ; exit 0 ;;",
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
});
