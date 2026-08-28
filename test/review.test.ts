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

describe("Aeon review hiring", () => {
  it("creates a review job pinned to the pull request commit", () => {
    const directory = mkdtempSync(join(tmpdir(), "cultos-review-"));
    directories.push(directory);
    const bin = join(directory, "bin");
    const acpLog = join(directory, "acp.log");
    const projectRoot = process.cwd();
    const pullRequestUrl = "https://github.com/thecultos/example/pull/47";
    const headSha = "a".repeat(40);

    writeFileSync(join(directory, "package.json"), "{}\n");
    writeFileSync(acpLog, "");
    mkdirSync(bin);
    writeFileSync(
      join(bin, "git"),
      `#!/bin/sh\nif [ "$*" = "rev-parse --show-toplevel" ]; then printf '%s\\n' "${directory}"; else exit 1; fi\n`
    );
    writeFileSync(
      join(bin, "gh"),
      [
        "#!/bin/sh",
        "case \"$*\" in",
        "  'repo view --json nameWithOwner,url,defaultBranchRef') echo '{\"nameWithOwner\":\"thecultos/example\",\"url\":\"https://github.com/thecultos/example\",\"defaultBranchRef\":{\"name\":\"main\"}}' ;;",
        "  'issue view 42 --json number,title,body,url') echo '{\"number\":42,\"title\":\"Review the parser\",\"body\":\"- [ ] Review the change\",\"url\":\"https://github.com/thecultos/example/issues/42\"}' ;;",
        `  'pr view ${pullRequestUrl} --json number,url,state,headRefOid,baseRefName') echo '{"number":47,"url":"${pullRequestUrl}","state":"OPEN","headRefOid":"${headSha}","baseRefName":"main"}' ;;`,
        "  *) exit 1 ;;",
        "esac"
      ].join("\n")
    );
    writeFileSync(
      join(bin, "acp"),
      "#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$ACP_LOG\"\nprintf '{\"jobId\":815,\"chainId\":8453}\\n'\n"
    );
    for (const command of ["git", "gh", "acp"]) chmodSync(join(bin, command), 0o755);

    const result = spawnSync(
      process.execPath,
      [
        "--import",
        join(projectRoot, "node_modules", "tsx", "dist", "loader.mjs"),
        join(projectRoot, "src", "cli.ts"),
        "hire",
        "42",
        "--pr",
        pullRequestUrl,
        "--provider",
        "0xd494a454888a390b2b05df74ae2b5fd9c9902b71",
        "--offering",
        "aeon_pull_request_review",
        "--platform",
        "github"
      ],
      {
        cwd: directory,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
          ACP_LOG: acpLog
        }
      }
    );

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const saved = JSON.parse(readFileSync(join(directory, ".cultos", "jobs.json"), "utf8"));
    expect(saved.jobs["42:review"]).toMatchObject({
      issueNumber: 42,
      service: "review",
      jobId: "815",
      contract: {
        kind: "cultos.github.review.v1",
        pullRequest: pullRequestUrl,
        headSha
      }
    });
    const invocation = readFileSync(acpLog, "utf8");
    expect(invocation).toContain("client create-job");
    expect(invocation).toContain("--offering-name aeon_pull_request_review");
    expect(invocation).toContain(`\"headSha\":\"${headSha}\"`);
  });
});
