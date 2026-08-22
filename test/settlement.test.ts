import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("settlement recovery", () => {
  it("retries a failed receipt without repeating the ACP action", () => {
    const directory = mkdtempSync(join(tmpdir(), "cultos-settlement-"));
    directories.push(directory);
    const bin = join(directory, "bin");
    const stateDirectory = join(directory, ".cultos");
    const acpLog = join(directory, "acp.log");
    const receiptLog = join(directory, "receipt.log");
    const projectRoot = process.cwd();

    writeFileSync(join(directory, "package.json"), "{}\n");
    writeFileSync(acpLog, "");
    writeFileSync(receiptLog, "");
    const state = {
      version: 1,
      jobs: {
        "42": {
          issueNumber: 42,
          repository: "thecultos/example",
          contract: {
            kind: "cultos.github.issue.v1",
            repository: "https://github.com/thecultos/example",
            issue: "https://github.com/thecultos/example/issues/42",
            baseRef: "main",
            title: "Test settlement",
            acceptanceCriteria: [],
            delivery: { type: "github.pull_request" }
          },
          provider: "0x1234",
          jobId: "813",
          chainId: 8453,
          status: "submitted",
          createdAt: "2026-08-20T12:00:00.000Z",
          updatedAt: "2026-08-20T12:00:00.000Z"
        }
      }
    };

    mkdirSync(bin, { recursive: true });
    mkdirSync(stateDirectory, { recursive: true });
    writeFileSync(join(stateDirectory, "jobs.json"), `${JSON.stringify(state)}\n`);
    writeFileSync(
      join(bin, "git"),
      "#!/bin/sh\nprintf '%s\\n' \"$TEST_REPO\"\n"
    );
    writeFileSync(
      join(bin, "acp"),
      "#!/bin/sh\nprintf 'reject\\n' >> \"$ACP_LOG\"\nprintf '{\"success\":true}\\n'\n"
    );
    writeFileSync(
      join(bin, "gh"),
      "#!/bin/sh\nif [ \"$GH_FAIL\" = 1 ]; then printf 'GitHub unavailable\\n' >&2; exit 1; fi\nprintf 'receipt\\n' >> \"$RECEIPT_LOG\"\n"
    );
    for (const command of ["git", "acp", "gh"]) {
      chmodSync(join(bin, command), 0o755);
    }

    const run = (fail: boolean) => spawnSync(
      process.execPath,
      [
        "--import",
        join(projectRoot, "node_modules", "tsx", "dist", "loader.mjs"),
        join(projectRoot, "src", "cli.ts"),
        "settle",
        "42",
        "--reject"
      ],
      {
        cwd: directory,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
          TEST_REPO: directory,
          ACP_LOG: acpLog,
          RECEIPT_LOG: receiptLog,
          GH_FAIL: fail ? "1" : "0"
        }
      }
    );

    const failedReceipt = run(true);
    expect(failedReceipt.status).toBe(1);
    expect(readFileSync(acpLog, "utf8"), `${failedReceipt.stdout}\n${failedReceipt.stderr}`).toBe("reject\n");

    expect(run(false).status).toBe(0);
    expect(readFileSync(acpLog, "utf8")).toBe("reject\n");
    expect(readFileSync(receiptLog, "utf8")).toBe("receipt\n");

    const saved = JSON.parse(readFileSync(join(stateDirectory, "jobs.json"), "utf8"));
    expect(saved.jobs["42"].settledByCultos).toBe("rejected");
    expect(saved.jobs["42"].receiptPostedAt).toBeTypeOf("string");
    expect(run(false).status).toBe(1);
    expect(readFileSync(receiptLog, "utf8")).toBe("receipt\n");
  });
});
