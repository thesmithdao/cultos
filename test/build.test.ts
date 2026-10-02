import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { machineFiles, validSolanaAddress, writeProject, x402Files, X402_VERSION } from "../src/build.js";
import { runBuildMachine, runBuildX402 } from "../src/builder.js";

const evm = "0x000000000000000000000000000000000000dEaD";
const solana = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "cultos-build-"));
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(directory, { recursive: true, force: true });
});

describe("cult build x402", () => {
  it("pins every x402 package and only includes the chosen rails", () => {
    const files = x402Files({ name: "api", rails: ["solana"], price: "0.002", description: "Weather", payToSolana: solana, mainnet: false });
    const pkg = JSON.parse(files["package.json"]!) as { dependencies: Record<string, string> };
    expect(pkg.dependencies["@x402/svm"]).toBe(X402_VERSION);
    expect(pkg.dependencies["@x402/evm"]).toBeUndefined();
    expect(Object.values(pkg.dependencies).every((version) => /^\d+\.\d+\.\d+$/.test(version))).toBe(true);
    expect(files["index.mjs"]).toContain("ExactSvmScheme");
    expect(files["index.mjs"]).not.toContain("ExactEvmScheme");
    expect(files["index.mjs"]).toContain("declareDiscoveryExtension");
    expect(files[".env"]).toContain("X402_NETWORK=testnet");
    expect(files[".env"]).toContain(`PAY_TO_SOLANA=${solana}`);
    expect(files[".gitignore"]).toContain(".env");
  });

  it("keeps secrets out of the example env and quotes the description", () => {
    const files = x402Files({ name: "api", rails: ["base", "solana"], price: "0.001", description: "Tides # and \"quotes\"", payToBase: evm, payToSolana: solana, mainnet: true });
    expect(files[".env.example"]).toContain("CDP_API_KEY_SECRET=\n");
    expect(files[".env"]).toContain("DESCRIPTION=\"Tides # and  quotes\"\n");
    expect(files[".env"]).toContain("X402_NETWORK=mainnet");
  });

  it("accepts only 32-byte Solana public keys", () => {
    expect(validSolanaAddress(solana)).toBe(true);
    expect(validSolanaAddress("3au3AcaDpXRJktuu8zWNWEBBufPN6tLSPiVJCsTgXcqn")).toBe(true);
    expect(validSolanaAddress("z".repeat(44))).toBe(false);
    expect(validSolanaAddress("1".repeat(32))).toBe(false);
    expect(validSolanaAddress("0OIl".repeat(10))).toBe(false);
  });

  it("rejects payouts nobody controls", () => {
    expect(() => x402Files({ name: "api", rails: ["base"], price: "0.001", description: "x", payToBase: `0x${"0".repeat(40)}`, mainnet: false })).toThrow("0x address");
    expect(() => machineFiles({ name: "m", device: "mac", payout: `0x${"0".repeat(40)}`, price: "0.001", mainnet: false })).toThrow("0x address");
    expect(() => x402Files({ name: "api", rails: ["solana"], price: "0.001", description: "x", payToSolana: "1".repeat(32), mainnet: false })).toThrow("Solana");
  });

  it("rejects bad payouts and prices", () => {
    expect(() => x402Files({ name: "api", rails: ["base"], price: "0.001", description: "x", payToBase: "0x123", mainnet: false })).toThrow("0x address");
    expect(() => x402Files({ name: "api", rails: ["base"], price: "-1", description: "x", payToBase: evm, mainnet: false })).toThrow("price");
    expect(() => x402Files({ name: "api", rails: [], price: "0.001", description: "x", mainnet: false })).toThrow("Base, Solana");
  });

  it("builds from flags without a terminal", async () => {
    const root = await runBuildX402(join(directory, "api"), { rails: "base", payToBase: evm, price: "0.001", description: "Hello" });
    expect(readFileSync(join(root, "package.json"), "utf8")).toContain("@x402/express");
    expect(statSync(join(root, ".env")).mode & 0o777).toBe(0o600);
  });

  it("asks until the answer is valid", async () => {
    const answers = ["api", "nope", "0.001", "Hello", evm];
    const asker = {
      ask: vi.fn(async (_question: string, fallback?: string) => answers.shift() ?? fallback ?? ""),
      confirm: vi.fn(async () => false),
      choose: vi.fn(async () => 0)
    };
    const root = await runBuildX402(join(directory, "asked"), {}, asker);
    expect(readFileSync(join(root, ".env"), "utf8")).toContain(`PAY_TO_BASE=${evm}`);
    expect(asker.ask).toHaveBeenCalledTimes(5);
  });
});

describe("cult build machine", () => {
  it("writes a Mac seller on testnet by default", () => {
    const files = machineFiles({ name: "mac", device: "mac", payout: evm, price: "0.001", mainnet: false });
    const config = JSON.parse(files["x402-mqtt.json"]!) as Record<string, unknown>;
    expect(config.source).toBe("mac");
    expect(config.network).toBe("eip155:84532");
    expect(config.facilitator).toBe("https://x402.org/facilitator");
    expect(files["package.json"]).toContain("\"@cultos/x402-mqtt\": \"0.1.4\"");
  });

  it("writes a Linux publisher and keeps broker passwords out of Git", () => {
    const files = machineFiles({ name: "box", device: "linux", payout: evm, price: "0.001", mainnet: true, broker: "mqtts://broker.example.com:8883" });
    expect(files["publisher.mjs"]).toContain("/proc/loadavg");
    expect(files[".gitignore"]).toContain("x402-mqtt.json");
    expect(JSON.parse(files["x402-mqtt.json"]!).facilitator).toBe("coinbase");
  });

  it("never sends broker passwords in cleartext to a remote broker", async () => {
    for (const broker of ["mqtt://broker.example.com:1883", "ws://10.0.0.5:9001/mqtt", "http://broker.example.com"]) {
      expect(() => machineFiles({ name: "box", device: "linux", payout: evm, price: "0.001", mainnet: false, broker })).toThrow("mqtts://");
      await expect(runBuildMachine(join(directory, `box-${broker.length}`), { device: "linux", payout: evm, broker })).rejects.toThrow();
    }
    for (const broker of ["mqtts://broker.example.com:8883", "wss://broker.example.com/mqtt", "mqtt://127.0.0.1:1883", "mqtt://localhost:1883"]) {
      expect(() => machineFiles({ name: "box", device: "linux", payout: evm, price: "0.001", mainnet: false, broker })).not.toThrow();
    }
  });

  it("needs a broker for Linux", async () => {
    await expect(runBuildMachine(join(directory, "box"), { device: "linux", payout: evm })).rejects.toThrow("broker");
  });
});

describe("writeProject", () => {
  it("never writes into a folder that has files", () => {
    writeFileSync(join(directory, "keep.txt"), "mine");
    expect(() => writeProject(directory, { "a.txt": "x" })).toThrow("not empty");
    expect(readFileSync(join(directory, "keep.txt"), "utf8")).toBe("mine");
  });
});
