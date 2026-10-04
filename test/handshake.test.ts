import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BASE_RPC, BASE_USDC, MACHINE_CONFIG, capUnits, configuredPayout, confirmOnBase, explorer, findTransaction, isTransactionFor, listingStatus, machineNetwork, runHandshake, salePayout } from "../src/handshake.js";

const payTo = "0x000000000000000000000000000000000000dEaD";
const tx = `0x${"ab".repeat(32)}`;

const transferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const buyerTopic = `0x${"0".repeat(24)}${"cd".repeat(20)}`;
const machinePayout = `0x${"cd".repeat(20)}`;
const deadTopic = `0x${"0".repeat(24)}${payTo.slice(2).toLowerCase()}`;

const solanaMainnet = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const solanaRpc = "https://api.mainnet-beta.solana.com";
const solanaMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const solanaPayout = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const solanaBuyer = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const signature = "5".repeat(88);

function receiptFetcher(result: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
    status: 200,
    headers: { "content-type": "application/json" }
  })) as typeof fetch;
}

const settledReceipt = {
  status: "0x1",
  logs: [{ address: BASE_USDC, topics: [transferTopic, buyerTopic, buyerTopic], data: "0x3e8" }]
};

const header = Buffer.from(JSON.stringify({
  x402Version: 2,
  accepts: [{ scheme: "exact", network: "eip155:8453", amount: "1000", asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", payTo, maxTimeoutSeconds: 60 }],
  extensions: { bazaar: { info: { input: { type: "object" }, output: { type: "object" } }, schema: {} } }
})).toString("base64");

const endpoint = "https://api.example.com/data";
const saleOnBase = {
  status: "0x1",
  logs: [{ address: BASE_USDC, topics: [transferTopic, buyerTopic, deadTopic], data: "0x3e8" }]
};

const solanaHeader = Buffer.from(JSON.stringify({
  x402Version: 2,
  accepts: [{ scheme: "exact", network: solanaMainnet, amount: "1000", asset: solanaMint, payTo: solanaPayout, maxTimeoutSeconds: 60 }],
  extensions: { bazaar: { info: { input: { type: "object" }, output: { type: "object" } }, schema: {} } }
})).toString("base64");

function json(result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200, headers: { "content-type": "application/json" } });
}

function quoting(receipt: unknown = saleOnBase): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("https://api.agentic.market")) return new Response("", { status: 404 });
    if (url === BASE_RPC) return json(receipt);
    return new Response(null, { status: 402, headers: { "PAYMENT-REQUIRED": header } });
  }) as typeof fetch;
}

function solanaQuoting(statuses: unknown, transaction: unknown): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://api.agentic.market")) return new Response("", { status: 404 });
    if (url === solanaRpc) {
      const { method } = JSON.parse(String(init?.body)) as { method: string };
      return json(method === "getSignatureStatuses" ? statuses : transaction);
    }
    return new Response(null, { status: 402, headers: { "PAYMENT-REQUIRED": solanaHeader } });
  }) as typeof fetch;
}

const quote = quoting();

let server: Server;
let origin: string;
let directory: string;
let previousPath: string | undefined;

beforeAll(async () => {
  server = createServer((_request, response) => {
    response.writeHead(402, { "PAYMENT-REQUIRED": header });
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "cultos-handshake-"));
  previousPath = process.env.PATH;
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  process.env.PATH = previousPath;
  vi.restoreAllMocks();
  rmSync(directory, { recursive: true, force: true });
});

function fakeAwal(output: string, address?: string): string {
  const log = join(directory, "awal.log");
  const path = join(directory, "awal");
  const reports = address ? `echo '${address}'; exit 0` : "exit 1";
  writeFileSync(path, `#!/bin/sh\necho "$*" >> '${log}'\nif [ "$1" = "--version" ]; then echo 2.12.1; exit 0; fi\nif [ "$1" = "address" ]; then ${reports}; fi\necho '${output}'\n`);
  chmodSync(path, 0o755);
  process.env.PATH = `${directory}:${previousPath}`;
  return log;
}

describe("cult handshake", () => {
  it("parses caps in USDC units", () => {
    expect(capUnits("0.01")).toBe(10_000n);
    expect(capUnits("1")).toBe(1_000_000n);
    expect(() => capUnits("0.0000001")).toThrow("--max");
  });

  it("finds a transaction anywhere in a receipt and links the right explorer", () => {
    expect(findTransaction({ data: { paymentResponse: { transaction: tx } } })).toBe(tx);
    expect(findTransaction({ status: 200 })).toBeUndefined();
    expect(explorer("eip155:8453", tx)).toBe(`https://basescan.org/tx/${tx}`);
    expect(explorer("eip155:1", tx)).toBeUndefined();
  });

  it("pays through awal with the cap and never without confirmation", async () => {
    const receipt = Buffer.from(JSON.stringify({ success: true, transaction: tx, network: "eip155:8453" })).toString("base64");
    const log = fakeAwal(JSON.stringify({ status: 200, paymentMade: true, data: { ok: true }, headers: { "PAYMENT-RESPONSE": receipt } }));
    const declined = await runHandshake(endpoint, { confirm: async () => false, fetcher: quote });
    expect(declined).toBe(false);
    expect(readFileSync(log, "utf8")).not.toContain("x402 pay");

    const paid = await runHandshake(endpoint, { confirm: async () => true, max: "0.002", fetcher: quote });
    expect(paid).toBe(true);
    const calls = readFileSync(log, "utf8");
    expect(calls).toContain(`x402 pay ${endpoint} -X GET --max-amount 2000 --scheme exact --json`);
  });

  it("refuses when every option costs more than the cap", async () => {
    const log = fakeAwal("{}");
    const result = await runHandshake(endpoint, { confirm: async () => true, max: "0.0005", fetcher: quote });
    expect(result).toBe(false);
    expect(existsSync(log)).toBe(false);
  });

  it("reports a payment that did not go through", async () => {
    fakeAwal(JSON.stringify({ success: false, error: { message: "insufficient balance" } }));
    expect(await runHandshake(endpoint, { confirm: async () => true, fetcher: quote })).toBe(false);
  });

  it("never counts a claimed success with no transaction as the first sale", async () => {
    for (const body of [
      { success: true, network: "eip155:8453" },
      { success: true, transaction: "", network: "eip155:8453" },
      { success: true, transaction: "not-a-hash", network: "eip155:8453" },
      { success: true, transaction: "0xabc", network: "eip155:8453" }
    ]) {
      const receipt = Buffer.from(JSON.stringify(body)).toString("base64");
      fakeAwal(JSON.stringify({ status: 200, headers: { "PAYMENT-RESPONSE": receipt } }));
      expect(await runHandshake(endpoint, { confirm: async () => true, fetcher: quote })).toBe(false);
    }
  });

  it("never counts a settlement on another network as the first sale", async () => {
    const receipt = Buffer.from(JSON.stringify({ success: true, transaction: tx, network: "eip155:84532" })).toString("base64");
    fakeAwal(JSON.stringify({ status: 200, headers: { "PAYMENT-RESPONSE": receipt } }));
    expect(await runHandshake(endpoint, { confirm: async () => true, fetcher: quote })).toBe(false);
  });

  it("never takes the seller's PAYMENT-RESPONSE as proof that awal paid", async () => {
    const forged = Buffer.from(JSON.stringify({ success: true, transaction: tx, network: "eip155:8453" })).toString("base64");
    for (const claim of [{}, { paymentMade: false }]) {
      fakeAwal(JSON.stringify({ status: 200, ...claim, headers: { "PAYMENT-RESPONSE": forged } }));
      expect(await runHandshake(endpoint, { confirm: async () => true, fetcher: quoting() })).toBe(false);
    }
  });

  it("matches the HTTP receipt to the quote, not to the header", async () => {
    const receipt = Buffer.from(JSON.stringify({ success: true, transaction: tx, network: "eip155:8453" })).toString("base64");
    const awal = JSON.stringify({ status: 200, paymentMade: true, headers: { "PAYMENT-RESPONSE": receipt } });
    const elsewhere = `0x${"0".repeat(24)}${"ef".repeat(20)}`;
    for (const onChain of [
      { status: "0x1", logs: [{ address: BASE_USDC, topics: [transferTopic, buyerTopic, deadTopic], data: "0x1" }] },
      { status: "0x1", logs: [{ address: BASE_USDC, topics: [transferTopic, buyerTopic, elsewhere], data: "0x3e8" }] },
      { status: "0x1", logs: [] },
      { status: "0x0", logs: [] }
    ]) {
      fakeAwal(awal);
      expect(await runHandshake(endpoint, { confirm: async () => true, fetcher: quoting(onChain) })).toBe(false);
    }
    fakeAwal(awal);
    expect(await runHandshake(endpoint, { confirm: async () => true, fetcher: quoting() })).toBe(true);
  });

  it("matches the payer to the wallet awal reports as its own", async () => {
    const receipt = Buffer.from(JSON.stringify({ success: true, transaction: tx, network: "eip155:8453" })).toString("base64");
    const awal = JSON.stringify({ status: 200, paymentMade: true, headers: { "PAYMENT-RESPONSE": receipt } });
    const stranger = `0x${"ab".repeat(20)}`;

    fakeAwal(awal, JSON.stringify({ evm: machinePayout, solana: solanaPayout }));
    expect(await runHandshake(endpoint, { confirm: async () => true, fetcher: quoting() })).toBe(true);

    fakeAwal(awal, JSON.stringify({ evm: stranger, solana: solanaPayout }));
    expect(await runHandshake(endpoint, { confirm: async () => true, fetcher: quoting() })).toBe(false);
  });

  it("confirms a Solana first sale from the token balances it moved", async () => {
    const receipt = Buffer.from(JSON.stringify({ success: true, transaction: signature, network: solanaMainnet })).toString("base64");
    const awal = JSON.stringify({ status: 200, paymentMade: true, headers: { "PAYMENT-RESPONSE": receipt } });
    const balance = (owner: string, accountIndex: number, amount: string) => ({ accountIndex, mint: solanaMint, owner, uiTokenAmount: { amount } });
    const moved = {
      meta: {
        preTokenBalances: [balance(solanaPayout, 1, "0"), balance(solanaBuyer, 2, "5000")],
        postTokenBalances: [balance(solanaPayout, 1, "1000"), balance(solanaBuyer, 2, "4000")]
      }
    };
    const short = {
      meta: {
        preTokenBalances: [balance(solanaPayout, 1, "0"), balance(solanaBuyer, 2, "5000")],
        postTokenBalances: [balance(solanaPayout, 1, "999"), balance(solanaBuyer, 2, "4001")]
      }
    };
    const confirmed = { value: [{ err: null, confirmationStatus: "finalized" }] };
    const lookup = { confirm: async () => true, tokenAccount: async () => true };

    fakeAwal(awal);
    expect(await runHandshake(endpoint, { ...lookup, fetcher: solanaQuoting(confirmed, moved) })).toBe(true);

    fakeAwal(awal, JSON.stringify({ evm: machinePayout, solana: solanaBuyer }));
    expect(await runHandshake(endpoint, { ...lookup, fetcher: solanaQuoting(confirmed, moved) })).toBe(true);

    fakeAwal(awal, JSON.stringify({ evm: machinePayout, solana: solanaPayout }));
    expect(await runHandshake(endpoint, { ...lookup, fetcher: solanaQuoting(confirmed, moved) })).toBe(false);

    for (const [statuses, transaction] of [
      [confirmed, short],
      [{ value: [{ err: { InstructionError: [0, "Custom"] }, confirmationStatus: "finalized" }], }, moved],
      [{ value: [{ err: null, confirmationStatus: "processed" }] }, moved],
      [{ value: [null] }, moved]
    ] as const) {
      fakeAwal(awal);
      expect(await runHandshake(endpoint, { ...lookup, fetcher: solanaQuoting(statuses, transaction) })).toBe(false);
    }
  });

  it("never counts a testnet payment as the first sale", async () => {
    const log = fakeAwal("{}");
    const testnet = Buffer.from(JSON.stringify({
      x402Version: 2,
      accepts: [{ scheme: "exact", network: "eip155:84532", amount: "1000", asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", payTo, maxTimeoutSeconds: 60 }],
      extensions: { bazaar: { info: { input: { type: "object" }, output: { type: "object" } }, schema: {} } }
    })).toString("base64");
    const fetcher = (async () => new Response(null, { status: 402, headers: { "PAYMENT-REQUIRED": testnet } })) as typeof fetch;
    expect(await runHandshake(endpoint, { confirm: async () => true, fetcher })).toBe(false);
    expect(existsSync(log)).toBe(false);
  });

  it("quotes the fallback payment command so a hostile URL cannot run in the shell", async () => {
    process.env.PATH = directory;
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => { lines.push(args.join(" ")); });
    await runHandshake("https://api.example.com/data?x=$(id)", { confirm: async () => false, fetcher: quote });
    const command = lines.find((line) => line.includes("x402 pay"));
    expect(command).toContain("'https://api.example.com/data?x=$(id)'");
  });

  it("never sends a first sale over plain http", async () => {
    const log = fakeAwal("{}");
    expect(await runHandshake(`${origin}/data`, { confirm: async () => true })).toBe(false);
    expect(existsSync(log)).toBe(false);
  });

  it("never pays a machine in check-only mode", async () => {
    const previous = process.env.X402_MQTT_BUYER_KEY;
    process.env.X402_MQTT_BUYER_KEY = "0x" + "1".repeat(64);
    const log = join(directory, "npx.log");
    writeFileSync(join(directory, "npx"), `#!/bin/sh\necho "$*" >> '${log}'\n`);
    chmodSync(join(directory, "npx"), 0o755);
    process.env.PATH = `${directory}:${previousPath}`;
    try {
      expect(await runHandshake("mac/cpu/load", { confirm: async () => true, yes: true, checkOnly: true })).toBe(true);
      expect(existsSync(log)).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.X402_MQTT_BUYER_KEY; else process.env.X402_MQTT_BUYER_KEY = previous;
    }
  });

  it("counts a machine sale only with a real Base transaction", async () => {
    const previous = process.env.X402_MQTT_BUYER_KEY;
    process.env.X402_MQTT_BUYER_KEY = "0x" + "1".repeat(64);
    process.env.PATH = `${directory}:${previousPath}`;
    try {
      writeFileSync(join(directory, "npx"), "#!/bin/sh\necho 'no eip155:8453 option in the quote' >&2\nexit 1\n");
      chmodSync(join(directory, "npx"), 0o755);
      expect(await runHandshake("mac/cpu/load", { confirm: async () => true, yes: true, payTo: machinePayout })).toBe(false);
      writeFileSync(join(directory, "npx"), `#!/bin/sh\necho 'paid $0.001 · 1.9 load · tx ${tx}'\n`);
      expect(await runHandshake("mac/cpu/load", {
        confirm: async () => true,
        yes: true,
        payTo: machinePayout,
        fetcher: receiptFetcher(settledReceipt)
      })).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.X402_MQTT_BUYER_KEY; else process.env.X402_MQTT_BUYER_KEY = previous;
    }
  });

  it("matches the receipt to the sale, not just to any USDC transfer", async () => {
    const previous = process.env.X402_MQTT_BUYER_KEY;
    process.env.X402_MQTT_BUYER_KEY = "0x" + "1".repeat(64);
    process.env.PATH = `${directory}:${previousPath}`;
    writeFileSync(join(directory, "npx"), `#!/bin/sh\necho 'paid $0.001 · 1.9 load · tx ${tx}'\n`);
    chmodSync(join(directory, "npx"), 0o755);
    const otherPayee = `0x${"0".repeat(24)}${"ef".repeat(20)}`;
    try {
      const wrongAmount = {
        status: "0x1",
        logs: [{ address: BASE_USDC, topics: [transferTopic, buyerTopic, buyerTopic], data: "0x1" }]
      };
      expect(await runHandshake("mac/cpu/load", {
        confirm: async () => true, yes: true, payTo: machinePayout, fetcher: receiptFetcher(wrongAmount)
      })).toBe(false);

      const wrongPayee = {
        status: "0x1",
        logs: [{ address: BASE_USDC, topics: [transferTopic, buyerTopic, otherPayee], data: "0x3e8" }]
      };
      expect(await runHandshake("mac/cpu/load", {
        confirm: async () => true, yes: true, payTo: `0x${"cd".repeat(20)}`, fetcher: receiptFetcher(wrongPayee)
      })).toBe(false);

      expect(await runHandshake("mac/cpu/load", {
        confirm: async () => true, yes: true, payTo: `0x${"cd".repeat(20)}`, fetcher: receiptFetcher(settledReceipt)
      })).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.X402_MQTT_BUYER_KEY; else process.env.X402_MQTT_BUYER_KEY = previous;
    }
  });

  it("refuses a machine sale that Base does not confirm", async () => {
    const previous = process.env.X402_MQTT_BUYER_KEY;
    process.env.X402_MQTT_BUYER_KEY = "0x" + "1".repeat(64);
    process.env.PATH = `${directory}:${previousPath}`;
    writeFileSync(join(directory, "npx"), `#!/bin/sh\necho 'paid $0.001 · 1.9 load · tx ${tx}'\n`);
    chmodSync(join(directory, "npx"), 0o755);
    try {
      for (const result of [
        null,
        { status: "0x0", logs: [] },
        { status: "0x1", logs: [] },
        { status: "0x1", logs: [{ address: "0x" + "9".repeat(40), topics: [transferTopic, buyerTopic, buyerTopic], data: "0x3e8" }] }
      ]) {
        expect(await runHandshake("mac/cpu/load", {
          confirm: async () => true,
          yes: true,
          payTo: machinePayout,
          fetcher: receiptFetcher(result)
        })).toBe(false);
      }
    } finally {
      if (previous === undefined) delete process.env.X402_MQTT_BUYER_KEY; else process.env.X402_MQTT_BUYER_KEY = previous;
    }
  });

  it("reads the payer and amount out of the USDC transfer log", async () => {
    const confirmed = await confirmOnBase(tx, { units: 1000n, payTo: machinePayout }, receiptFetcher(settledReceipt));

    expect(confirmed.settled).toBe(true);
    expect(confirmed.amount).toBe("1000");
    expect(confirmed.payer).toBe(`0x${"cd".repeat(20)}`);
  });

  it("pays a Solana machine with the published buyer and confirms the selected rail", async () => {
    const previous = process.env.X402_MQTT_BUYER_KEY;
    process.env.X402_MQTT_BUYER_KEY = "1".repeat(64);
    const log = join(directory, "npx.log");
    writeFileSync(join(directory, "npx"), `#!/bin/sh\necho "$*" >> '${log}'\necho 'paid $0.001 · 1.9 load · tx ${signature}'\n`);
    chmodSync(join(directory, "npx"), 0o755);
    process.env.PATH = `${directory}:${previousPath}`;
    const balance = (owner: string, index: number, amount: string, mint = solanaMint) => ({ accountIndex: index, mint, owner, uiTokenAmount: { amount } });
    const moved = { meta: { preTokenBalances: [balance(solanaPayout, 1, "0"), balance(solanaBuyer, 2, "5000")], postTokenBalances: [balance(solanaPayout, 1, "1000"), balance(solanaBuyer, 2, "4000")] } };
    const confirmed = { value: [{ err: null, confirmationStatus: "finalized" }] };
    const options = { confirm: async () => true, yes: true, network: "solana", payTo: solanaPayout, max: "0.001" };
    try {
      expect(await runHandshake("mac/cpu/load", { ...options, fetcher: solanaQuoting(confirmed, moved) })).toBe(true);
      expect(readFileSync(log, "utf8")).toContain("@cultos/x402-mqtt@0.2.0 buy mac/cpu/load --network solana");
      expect(readFileSync(log, "utf8")).toContain("--max 0.001");
      for (const transaction of [
        { meta: { preTokenBalances: moved.meta.preTokenBalances, postTokenBalances: [balance(solanaPayout, 1, "999")] } },
        { meta: { preTokenBalances: moved.meta.preTokenBalances, postTokenBalances: [balance(solanaBuyer, 1, "1000")] } },
        { meta: { preTokenBalances: [], postTokenBalances: [balance(solanaPayout, 1, "1000", "wrong-mint")] } }
      ]) {
        expect(await runHandshake("mac/cpu/load", { ...options, fetcher: solanaQuoting(confirmed, transaction) })).toBe(false);
      }
      expect(await runHandshake("mac/cpu/load", { ...options, fetcher: solanaQuoting({ value: [{ err: "failed", confirmationStatus: "finalized" }] }, moved) })).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.X402_MQTT_BUYER_KEY; else process.env.X402_MQTT_BUYER_KEY = previous;
    }
  });

  it("refuses wrong machine networks and payouts before invoking the buyer", async () => {
    const log = join(directory, "npx.log");
    writeFileSync(join(directory, "npx"), `#!/bin/sh\necho "$*" >> '${log}'\n`);
    chmodSync(join(directory, "npx"), 0o755);
    process.env.PATH = `${directory}:${previousPath}`;
    const working = process.cwd();
    process.chdir(directory);
    try {
      for (const options of [{ network: "devnet" }, { network: "solana", payTo: machinePayout }, { network: "base", payTo: solanaPayout }]) {
        await expect(runHandshake("mac/cpu/load", { confirm: async () => true, yes: true, ...options })).rejects.toThrow();
      }
      for (const network of ["eip155:84532", "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", "unknown"]) {
        writeFileSync(join(directory, MACHINE_CONFIG), JSON.stringify({ network, payout: machinePayout }));
        await expect(runHandshake("mac/cpu/load", { confirm: async () => true, yes: true })).rejects.toThrow("mainnet");
      }
      expect(existsSync(log)).toBe(false);
    } finally {
      process.chdir(working);
    }
  });

  it("selects the payout from Solana-only and dual-network machine projects", () => {
    writeFileSync(join(directory, MACHINE_CONFIG), JSON.stringify({ network: solanaMainnet, payout: solanaPayout }));
    expect(configuredPayout(directory, "solana")).toBe(solanaPayout);
    expect(configuredPayout(directory, "base")).toBeUndefined();
    writeFileSync(join(directory, MACHINE_CONFIG), JSON.stringify({ network: "eip155:8453", payout: machinePayout, solanaPayout }));
    expect(salePayout(undefined, directory, "solana")).toBe(solanaPayout);
    expect(salePayout(undefined, directory, "base")).toBe(machinePayout);
  });

  it("uses the project network by default and selects a dual-network Solana offer", async () => {
    const previous = process.env.X402_MQTT_BUYER_KEY;
    const working = process.cwd();
    process.env.X402_MQTT_BUYER_KEY = "1".repeat(64);
    const log = join(directory, "npx.log");
    writeFileSync(join(directory, "npx"), `#!/bin/sh\necho "$*" >> '${log}'\necho 'paid $0.001 · reading · tx ${signature}'\n`);
    chmodSync(join(directory, "npx"), 0o755);
    process.env.PATH = `${directory}:${previousPath}`;
    process.chdir(directory);
    const balance = (amount: string) => ({ accountIndex: 1, mint: solanaMint, owner: solanaPayout, uiTokenAmount: { amount } });
    const fetcher = solanaQuoting({ value: [{ err: null, confirmationStatus: "finalized" }] }, { meta: { preTokenBalances: [balance("0")], postTokenBalances: [balance("1000")] } });
    try {
      writeFileSync(join(directory, MACHINE_CONFIG), JSON.stringify({ network: solanaMainnet, payout: solanaPayout }));
      expect(await runHandshake("mac/cpu/load", { confirm: async () => true, yes: true, fetcher })).toBe(true);
      writeFileSync(join(directory, MACHINE_CONFIG), JSON.stringify({ network: "eip155:8453", payout: machinePayout, solanaPayout }));
      expect(await runHandshake("mac/cpu/load", { network: "solana", confirm: async () => true, yes: true, fetcher })).toBe(true);
      expect(readFileSync(log, "utf8").split("\n").filter(Boolean)).toHaveLength(2);
      expect(readFileSync(log, "utf8").split("\n").filter(Boolean).every((line) => line.includes("--network solana"))).toBe(true);
    } finally {
      process.chdir(working);
      if (previous === undefined) delete process.env.X402_MQTT_BUYER_KEY; else process.env.X402_MQTT_BUYER_KEY = previous;
    }
  });

  it("refuses a receipt from the wrong rail or above the cap", async () => {
    const previous = process.env.X402_MQTT_BUYER_KEY;
    process.env.X402_MQTT_BUYER_KEY = "1".repeat(64);
    process.env.PATH = `${directory}:${previousPath}`;
    writeFileSync(join(directory, "npx"), "#!/bin/sh\n");
    chmodSync(join(directory, "npx"), 0o755);
    const fetcher = vi.fn(async () => { throw new Error("must not query a mismatched receipt"); }) as unknown as typeof fetch;
    try {
      for (const output of [`paid $0.001 · reading · tx ${tx}`, `paid $0.002 · reading · tx ${signature}`]) {
        writeFileSync(join(directory, "npx"), `#!/bin/sh\necho '${output}'\n`);
        expect(await runHandshake("mac/cpu/load", { confirm: async () => true, yes: true, network: "solana", payTo: solanaPayout, max: "0.001", fetcher })).toBe(false);
      }
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.X402_MQTT_BUYER_KEY; else process.env.X402_MQTT_BUYER_KEY = previous;
    }
  });

  it("rejects the machine network flag on an HTTP handshake", async () => {
    await expect(runHandshake(endpoint, { network: "solana", confirm: async () => true })).rejects.toThrow("machine");
  });

  it("needs the machine payout to prove the sale, and spends nothing while it has none", async () => {
    const previous = process.env.X402_MQTT_BUYER_KEY;
    const working = process.cwd();
    process.env.X402_MQTT_BUYER_KEY = "0x" + "1".repeat(64);
    const log = join(directory, "npx.log");
    writeFileSync(join(directory, "npx"), `#!/bin/sh\necho "$*" >> '${log}'\n`);
    chmodSync(join(directory, "npx"), 0o755);
    process.env.PATH = `${directory}:${previousPath}`;
    process.chdir(directory);
    try {
      expect(await runHandshake("mac/cpu/load", { confirm: async () => true, yes: true })).toBe(false);
      for (const bad of ["0xnope", `0x${"0".repeat(40)}`]) {
        await expect(runHandshake("mac/cpu/load", { confirm: async () => true, yes: true, payTo: bad }))
          .rejects.toThrow(/0x address/);
      }
      expect(existsSync(log)).toBe(false);

      writeFileSync(join(directory, MACHINE_CONFIG), JSON.stringify({ payout: machinePayout, price: "0.001" }));
      writeFileSync(join(directory, "npx"), `#!/bin/sh\necho 'paid $0.001 · 1.9 load · tx ${tx}'\n`);
      expect(await runHandshake("mac/cpu/load", {
        confirm: async () => true, yes: true, fetcher: receiptFetcher(settledReceipt)
      })).toBe(true);
    } finally {
      process.chdir(working);
      if (previous === undefined) delete process.env.X402_MQTT_BUYER_KEY; else process.env.X402_MQTT_BUYER_KEY = previous;
    }
  });

  it("takes the payout from the machine project only when the file really carries one", () => {
    expect(configuredPayout(directory)).toBeUndefined();
    for (const content of ["not json", JSON.stringify({ price: "0.001" }), JSON.stringify({ payout: 7 }), JSON.stringify({ payout: `0x${"0".repeat(40)}` })]) {
      writeFileSync(join(directory, MACHINE_CONFIG), content);
      expect(configuredPayout(directory)).toBeUndefined();
    }
    writeFileSync(join(directory, MACHINE_CONFIG), JSON.stringify({ payout: machinePayout }));
    expect(configuredPayout(directory)).toBe(machinePayout);
    expect(salePayout(undefined, directory)).toBe(machinePayout);
    expect(salePayout(payTo, directory)).toBe(payTo);
  });

  it("agrees with itself about what a transaction looks like", () => {
    const long = "z".repeat(88);
    expect(isTransactionFor(solanaMainnet, long)).toBe(false);
    expect(explorer(solanaMainnet, long)).toBeUndefined();
    expect(isTransactionFor(solanaMainnet, signature)).toBe(true);
    expect(explorer(solanaMainnet, signature)).toBe(`https://solscan.io/tx/${signature}`);
    expect(isTransactionFor("eip155:8453", signature)).toBe(false);
    expect(explorer("eip155:8453", signature)).toBeUndefined();
    expect(explorer("eip155:1", tx)).toBeUndefined();
  });

  it("reads the machine network from the project it is run in", () => {
    expect(machineNetwork(undefined, directory).id).toBe("eip155:8453");
    writeFileSync(join(directory, MACHINE_CONFIG), JSON.stringify({ network: solanaMainnet, payout: solanaPayout }));
    expect(machineNetwork(undefined, directory).id).toBe(solanaMainnet);
    expect(machineNetwork("base", directory).id).toBe("eip155:8453");
    writeFileSync(join(directory, MACHINE_CONFIG), JSON.stringify({ network: "eip155:84532", payout: machinePayout }));
    expect(() => machineNetwork(undefined, directory)).toThrow("--mainnet");
    expect(() => machineNetwork("devnet", directory)).toThrow("--network must be base or solana");
  });

  it("refuses a broker or topic that the paying path should not accept", async () => {
    await expect(runHandshake("mac/cpu/load", { broker: "mqtt://remote.example.com", confirm: async () => true }))
      .rejects.toThrow(/mqtts:\/\/ or wss:\/\//);
    await expect(runHandshake("--broker", { confirm: async () => true }))
      .rejects.toThrow(/Invalid machine topic/);
  });

  it("asks for the buyer's own key for machines instead of holding one", async () => {
    const previous = process.env.X402_MQTT_BUYER_KEY;
    delete process.env.X402_MQTT_BUYER_KEY;
    try {
      expect(await runHandshake("mac/cpu/load", { confirm: async () => true })).toBe(false);
    } finally {
      if (previous !== undefined) process.env.X402_MQTT_BUYER_KEY = previous;
    }
  });

  it("never prints terminal control sequences from a hostile payment header", async () => {
    const hostile = Buffer.from(JSON.stringify({
      x402Version: 2,
      accepts: [
        { scheme: "exact\u001b]52;c;cHduZWQ=\u0007", network: "eip155:8453\u001b[2J", amount: "1000", asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913\u001b[31m", payTo: "\u001b[1A\u001b[2Kpaid", maxTimeoutSeconds: 60 },
        { scheme: "exact", network: "solana:\u001b[2Jfake", amount: "1000", asset: "x", payTo: "y" }
      ]
    })).toString("base64");
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => { lines.push(args.join(" ")); });
    const fetcher = (async () => new Response(null, { status: 402, headers: { "PAYMENT-REQUIRED": hostile } })) as typeof fetch;
    await runHandshake("https://api.example.com/data", { confirm: async () => false, fetcher });
    const printed = lines.join("\n").replace(/\u001b\[[0-9;]*m/g, "");
    expect(printed).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/);
  });

  it("reads the Agentic Market listing", async () => {
    const listed = async () => new Response(JSON.stringify({ endpoints: [{ url: "https://api.example.com/data" }] }), { status: 200 });
    expect(await listingStatus("https://api.example.com/data", listed as typeof fetch)).toBe("listed on Agentic Market");
    expect(await listingStatus("https://api.example.com/other", listed as typeof fetch)).toContain("endpoint not yet");
    expect(await listingStatus("https://api.example.com/data", (async () => new Response("", { status: 404 })) as typeof fetch)).toContain("not on Agentic Market yet");
    expect(await listingStatus("http://localhost:4021/data")).toContain("local only");
  });
});
