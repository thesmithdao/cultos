import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runDoctor } from "../src/doctor.js";

let directory: string;
let previousPath: string | undefined;

function stub(name: string, body: string): void {
  const path = join(directory, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`, "utf8");
  chmodSync(path, 0o755);
}

function output(): string {
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  try {
    runDoctor();
    return log.mock.calls.map((call) => call.join(" ")).join("\n");
  } finally {
    log.mockRestore();
  }
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "cultos-doctor-"));
  previousPath = process.env.PATH;
  // git and gh have to exist for the surrounding checks; only acp varies per test.
  stub("git", "exit 0");
  stub("gh", "exit 0");
  process.env.PATH = `${directory}${delimiter}${previousPath ?? ""}`;
});

afterEach(() => {
  process.env.PATH = previousPath;
  rmSync(directory, { recursive: true, force: true });
});

describe("cult doctor", () => {
  it("reports an unreadable agent response instead of crashing", () => {
    // An ACP CLI that prints a warning before its JSON used to take the whole
    // command down with a SyntaxError, which is the worst possible moment: the
    // tool is only ever run because something is already wrong.
    stub("acp", [
      "case \"$*\" in",
      "  *agent\\ whoami*) echo 'warning: update available' ; exit 0 ;;",
      "  *) exit 0 ;;",
      "esac"
    ].join("\n"));

    const report = output();

    expect(report).toContain("unreadable response");
    expect(report).toContain("actions required");
  });

  it("survives an agent response that is missing its fields", () => {
    stub("acp", [
      "case \"$*\" in",
      "  *agent\\ whoami*) echo '{\"id\":\"agent-1\"}' ; exit 0 ;;",
      "  *) exit 0 ;;",
      "esac"
    ].join("\n"));

    expect(() => output()).not.toThrow();
    expect(output()).toContain("unreadable response");
  });

  it("survives an unreadable signer policy", () => {
    stub("acp", [
      "case \"$*\" in",
      "  *agent\\ whoami*) echo '{\"name\":\"Example\",\"walletAddress\":\"0x1234567890abcdef\"}' ; exit 0 ;;",
      "  *signer-policy*) echo 'not json' ; exit 0 ;;",
      "  *) exit 0 ;;",
      "esac"
    ].join("\n"));

    const report = output();

    expect(report).toContain("Example");
    expect(report).toContain("unreadable response");
  });

  it("reports a ready signer", () => {
    stub("acp", [
      "case \"$*\" in",
      "  *agent\\ whoami*) echo '{\"name\":\"Example\",\"walletAddress\":\"0x1234567890abcdef\"}' ; exit 0 ;;",
      "  *signer-policy*) echo '{\"matched\":true}' ; exit 0 ;;",
      "  *) exit 0 ;;",
      "esac"
    ].join("\n"));

    const report = output();

    expect(report).toContain("ready");
    expect(report).not.toContain("unreadable response");
  });

  it("shortens a wallet address without assuming its length", () => {
    stub("acp", [
      "case \"$*\" in",
      "  *agent\\ whoami*) echo '{\"name\":\"Example\",\"walletAddress\":\"0x12\"}' ; exit 0 ;;",
      "  *signer-policy*) echo '{\"matched\":true}' ; exit 0 ;;",
      "  *) exit 0 ;;",
      "esac"
    ].join("\n"));

    expect(output()).toContain("0x12");
  });
});
