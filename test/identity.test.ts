import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("provider identity guard", () => {
  it("refuses the buyer and allows the recorded provider before quoting", () => {
    const directory = mkdtempSync(join(tmpdir(), "cultos-identity-"));
    directories.push(directory);
    const bin = join(directory, "bin");
    const stateDirectory = join(directory, ".cultos");
    const acpLog = join(directory, "acp.log");
    const projectRoot = process.cwd();
    const buyer = "0x1111111111111111111111111111111111111111";
    const provider = "0x2222222222222222222222222222222222222222";
    mkdirSync(bin);
    mkdirSync(stateDirectory);
    writeFileSync(join(directory, "package.json"), "{}\n");
    writeFileSync(acpLog, "");
    writeFileSync(join(stateDirectory, "jobs.json"), `${JSON.stringify({
      version: 1,
      jobs: {
        "2": {
          issueNumber: 2,
          repository: "cultosagent/review-lab",
          contract: {
            kind: "cultos.github.issue.v1",
            repository: "https://github.com/cultosagent/review-lab",
            issue: "https://github.com/cultosagent/review-lab/issues/2",
            baseRef: "main",
            title: "Review settlement guard",
            acceptanceCriteria: [],
            delivery: { type: "github.pull_request" }
          },
          provider,
          jobId: "78339",
          chainId: 8453,
          status: "open",
          createdAt: "2026-09-10T00:00:00.000Z",
          updatedAt: "2026-09-10T00:00:00.000Z"
        }
      }
    })}\n`);
    writeFileSync(join(bin, "git"), `#!/bin/sh\nif [ "$*" = "rev-parse --show-toplevel" ]; then printf '%s\\n' "${directory}"; else exit 1; fi\n`);
    writeFileSync(join(bin, "acp"), [
      "#!/bin/sh",
      `printf '%s\\n' "$*" >> "${acpLog}"`,
      "case \"$*\" in",
      `  'agent whoami --json') if [ "$ACTIVE_ROLE" = provider ]; then echo '{"id":"provider-id","name":"Provider","walletAddress":"${provider}"}'; else echo '{"id":"buyer-id","name":"Buyer","walletAddress":"${buyer}"}'; fi ;;`,
      `  'agent list --json') echo '{"data":[{"id":"buyer-id","name":"Buyer","walletAddress":"${buyer}"},{"id":"provider-id","name":"Provider","walletAddress":"${provider}"}]}' ;;`,
      "  provider\\ set-budget*) echo '{\"success\":true}' ;;",
      "  *) exit 1 ;;",
      "esac"
    ].join("\n"));
    for (const command of ["git", "acp"]) chmodSync(join(bin, command), 0o755);

    const run = (role: "buyer" | "provider") => spawnSync(process.execPath, [
      "--import",
      join(projectRoot, "node_modules", "tsx", "dist", "loader.mjs"),
      join(projectRoot, "src", "cli.ts"),
      "quote",
      "2",
      "--amount",
      "0.01"
    ], {
      cwd: directory,
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`, ACTIVE_ROLE: role }
    });

    const refused = run("buyer");
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain("Run cult agent use provider-id");
    expect(readFileSync(acpLog, "utf8")).not.toContain("provider set-budget");

    writeFileSync(acpLog, "");
    const allowed = run("provider");
    expect(allowed.status, `${allowed.stdout}\n${allowed.stderr}`).toBe(0);
    expect(allowed.stdout).toContain(`Provider identity: Provider · ${provider}`);
    expect(readFileSync(acpLog, "utf8")).toContain("provider set-budget --job-id 78339");
  });
});
