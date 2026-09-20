import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Several suites drive the CLI end to end by spawning `tsx` against stub
    // executables on PATH. A cold `tsx` start can exceed vitest's 5s default
    // on a slower disk, which shows up as four unrelated timeouts that look
    // like real failures. The work itself takes well under a second.
    testTimeout: 30_000,
    hookTimeout: 30_000
  }
});
