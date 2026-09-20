import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { jobReference, parseCultState, writeStateFile, type CultState } from "../src/state.js";

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

  test("keeps work and review jobs separate", () => {
    expect(jobReference({ issueNumber: 42 })).toBe("42");
    expect(jobReference({ issueNumber: 42, service: "review" })).toBe("42:review");
  });
});

describe("state keys that mean something to a plain object", () => {
  const job = {
    issueNumber: "__proto__",
    repository: "z6MkOwner/example",
    contract: {
      kind: "cultos.gitlawb.issue.v1",
      repository: "gitlawb://did:key:z6MkOwner/example",
      issue: "gitlawb://did:key:z6MkOwner/example/issues/__proto__",
      baseRef: "main",
      title: "Fix the adapter",
      acceptanceCriteria: [],
      delivery: { type: "gitlawb.pull_request" }
    },
    provider: "0xabc",
    jobId: "813",
    chainId: 8453,
    status: "open",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };

  test("rejects a reserved issue id instead of losing the job", () => {
    // Built through JSON.parse rather than an object literal: `__proto__:` in
    // a literal is the prototype setter, while JSON.parse creates a real own
    // property -- which is how it would arrive from .cultos/jobs.json.
    const state = JSON.parse(JSON.stringify({ version: 1, jobs: { placeholder: job } })
      .replace('"placeholder"', '"__proto__"'));

    expect(Object.hasOwn(state.jobs, "__proto__")).toBe(true);
    expect(() => parseCultState(state)).toThrow();
  });

  test("shows why a reserved name had to be rejected", () => {
    // The hazard the check exists for: assigning this key to a plain object
    // reassigns its prototype instead of storing anything, so the job was
    // serialised away to nothing -- after the ACP job already existed on-chain.
    const jobs: Record<string, unknown> = {};
    jobs["__proto__"] = job;

    expect(Object.hasOwn(jobs, "__proto__")).toBe(false);
    expect(JSON.stringify(jobs)).toBe("{}");
  });

  test("a parsed state does not answer for names it never stored", () => {
    const state = parseCultState({ version: 1, jobs: {} });

    for (const name of ["toString", "constructor", "hasOwnProperty", "valueOf"]) {
      expect(state.jobs[name]).toBeUndefined();
    }
  });

  test("an empty state does not answer for inherited names either", () => {
    const state = parseCultState({ version: 1, jobs: {} });

    expect(Object.getPrototypeOf(state.jobs)).toBeNull();
  });
});

describe("state reads within one command", () => {
  test("parses the file once and serves later lookups from memory", async () => {
    // getJob, then updateJob's own getJob and saveJob, then printJob: one
    // command hit the file up to four times and re-validated it each time.
    const readFileSync = vi.fn(() => JSON.stringify({ version: 1, jobs: {} }));
    vi.resetModules();
    vi.doMock("node:fs", async () => ({
      ...(await vi.importActual<typeof import("node:fs")>("node:fs")),
      readFileSync
    }));

    const state = await import("../src/state.js");

    expect(() => state.getJob(1)).toThrow();
    expect(() => state.getJob(2)).toThrow();
    expect(state.listJobs()).toEqual([]);

    expect(readFileSync).toHaveBeenCalledTimes(1);

    vi.doUnmock("node:fs");
    vi.resetModules();
  });
});
