import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
import { parseCultState, writeStateFile, type CultState } from "../src/state.js";

const state: CultState = {
  version: 1,
  jobs: {}
};

describe("local job state", () => {
  test("rejects malformed state", () => {
    expect(() => parseCultState({ version: 1, jobs: { "7": { status: "verified" } } })).toThrow();
  });

  test("writes owner-only files", () => {
    const directory = mkdtempSync(join(tmpdir(), "cultos-state-"));
    const path = join(directory, ".cultos", "jobs.json");

    writeStateFile(path, state);

    expect(statSync(dirname(path)).mode & 0o777).toBe(0o700);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(state);
  });
});
