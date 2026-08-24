import { beforeEach, describe, expect, test, vi } from "vitest";

const childProcess = vi.hoisted(() => ({
  execFileSync: vi.fn(),
  spawnSync: vi.fn()
}));

vi.mock("node:child_process", () => childProcess);

import { getPullRequestChecks } from "../src/github.js";

describe("GitHub checks", () => {
  beforeEach(() => {
    childProcess.spawnSync.mockReset();
  });

  test("accepts an empty check list", () => {
    childProcess.spawnSync.mockReturnValue({ status: 1, stdout: "", stderr: "" });

    expect(getPullRequestChecks("https://github.com/example/repo/pull/1")).toEqual([]);
  });
});
