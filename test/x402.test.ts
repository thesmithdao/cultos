import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkEndpoint, decodePaymentRequired, formatUsdc, inspectAccept, isSolanaSignature, passed, type TokenAccountLookup } from "../src/x402.js";

const neverCalled: TokenAccountLookup = async () => {
  throw new Error("a test reached the real Solana RPC: inject tokenAccount");
};

const baseUsdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const payTo = "0x000000000000000000000000000000000000dEaD";

function header(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64");
}

const good = {
  x402Version: 2,
  accepts: [{ scheme: "exact", network: "eip155:8453", amount: "1000", asset: baseUsdc, payTo, maxTimeoutSeconds: 60 }],
  extensions: { bazaar: { info: { input: { type: "object" }, output: { type: "object" } }, schema: {} } }
};

let server: Server;
let origin: string;

beforeAll(async () => {
  server = createServer((request, response) => {
    if (request.url === "/good") {
      response.writeHead(402, { "PAYMENT-REQUIRED": header(good) });
      return response.end();
    }
    if (request.url === "/wrong-asset") {
      response.writeHead(402, { "PAYMENT-REQUIRED": header({ ...good, accepts: [{ ...good.accepts[0], asset: "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42" }] }) });
      return response.end();
    }
    if (request.url === "/no-bazaar") {
      response.writeHead(402, { "PAYMENT-REQUIRED": header({ ...good, extensions: {} }) });
      return response.end();
    }
    if (request.url === "/other-chain") {
      response.writeHead(402, { "PAYMENT-REQUIRED": header({ ...good, accepts: [{ ...good.accepts[0], network: "eip155:1" }] }) });
      return response.end();
    }
    if (request.url === "/garbage") {
      response.writeHead(402, { "PAYMENT-REQUIRED": "not base64!" });
      return response.end();
    }
    if (request.url === "/post" && request.method === "POST") {
      response.writeHead(402, { "PAYMENT-REQUIRED": header(good) });
      return response.end();
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end("{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

describe("cult check", () => {
  it("passes a ready endpoint and notes plain http on localhost", async () => {
    const result = await checkEndpoint(`${origin}/good`, { tokenAccount: neverCalled });
    expect(passed(result)).toBe(true);
    expect(result.findings.find((finding) => finding.label === "TLS")?.level).toBe("warn");
    expect(result.findings.some((finding) => finding.detail === "price 0.001 USDC")).toBe(true);
  });

  it("fails an asset that is not USDC", async () => {
    const result = await checkEndpoint(`${origin}/wrong-asset`, { tokenAccount: neverCalled });
    expect(passed(result)).toBe(false);
  });

  it("fails a network outside Base and Solana", async () => {
    const result = await checkEndpoint(`${origin}/other-chain`, { tokenAccount: neverCalled });
    expect(passed(result)).toBe(false);
  });

  it("accepts only a base58 signature that really decodes to 64 bytes", () => {
    expect(isSolanaSignature("5".repeat(88))).toBe(true);
    expect(isSolanaSignature("5".repeat(87))).toBe(true);
    expect(isSolanaSignature("z".repeat(88))).toBe(false);
    expect(isSolanaSignature("5".repeat(89))).toBe(false);
    expect(isSolanaSignature("5".repeat(64))).toBe(false);
    expect(isSolanaSignature("1".repeat(64))).toBe(false);
    expect(isSolanaSignature(`5${"0".repeat(87)}`)).toBe(false);
    expect(isSolanaSignature("")).toBe(false);
  });

  it("fails an empty or null Bazaar field", async () => {
    for (const bazaar of [null, {}, "yes", [], { info: null }, { info: {} }, { info: { schema: {} } }, { info: { output: "yes" } }, { info: { input: true, output: 1 } }, { info: { input: [] } }, { info: { output: {} } }, { info: { input: {}, output: {} } }, [{ info: { input: { type: "object" } } }]]) {
      const fetcher = (async () => new Response(null, { status: 402, headers: { "PAYMENT-REQUIRED": header({ ...good, extensions: { bazaar } }) } })) as typeof fetch;
      expect(passed(await checkEndpoint("https://api.example.com/data", { fetcher }))).toBe(false);
    }
  });

  it("fails without Bazaar metadata", async () => {
    const result = await checkEndpoint(`${origin}/no-bazaar`, { tokenAccount: neverCalled });
    expect(passed(result)).toBe(false);
    expect(result.findings.find((finding) => finding.label === "Bazaar")?.level).toBe("fail");
  });

  it("fails a challenge that is not x402 v2", async () => {
    const v1 = (async () => new Response(null, { status: 402, headers: { "PAYMENT-REQUIRED": header({ ...good, x402Version: 1 }) } })) as typeof fetch;
    expect(passed(await checkEndpoint("https://api.example.com/data", { fetcher: v1 }))).toBe(false);
  });

  it("fails an unreadable payment header", async () => {
    const result = await checkEndpoint(`${origin}/garbage`, { tokenAccount: neverCalled });
    expect(passed(result)).toBe(false);
  });

  it("fails an endpoint that does not ask for payment", async () => {
    const result = await checkEndpoint(`${origin}/free`, { tokenAccount: neverCalled });
    expect(passed(result)).toBe(false);
    expect(result.status).toBe(200);
  });

  it("sends a body as POST", async () => {
    const result = await checkEndpoint(`${origin}/post`, { data: "{\"q\":1}" });
    expect(passed(result)).toBe(true);
  });

  it("refuses plain http to a remote host", async () => {
    const result = await checkEndpoint("http://example.invalid/data", { fetcher: async () => new Response(null, { status: 402 }) });
    expect(result.findings.find((finding) => finding.label === "TLS")?.level).toBe("fail");
  });

  it("checks Solana USDC exactly and marks testnets", () => {
    const solana = inspectAccept({ scheme: "exact", network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", amount: "1000", asset: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", payTo: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM" });
    expect(solana.every((finding) => finding.level !== "fail")).toBe(true);
    expect(solana.some((finding) => finding.detail.startsWith("testnet"))).toBe(true);
    const wrongMint = inspectAccept({ scheme: "exact", network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", amount: "1000", asset: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", payTo: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM" });
    expect(wrongMint.some((finding) => finding.level === "fail")).toBe(true);
  });

  it("never counts a scheme it does not check toward readiness", async () => {
    const upto = { ...good, accepts: [{ ...good.accepts[0], scheme: "upto" }] };
    const onlyUpto = (async () => new Response(null, { status: 402, headers: { "PAYMENT-REQUIRED": header(upto) } })) as typeof fetch;
    expect(passed(await checkEndpoint("https://api.example.com/data", { fetcher: onlyUpto }))).toBe(false);
    const both = { ...good, accepts: [...good.accepts, { ...good.accepts[0], scheme: "upto", payTo: "not-an-address" }] };
    const mixed = (async () => new Response(null, { status: 402, headers: { "PAYMENT-REQUIRED": header(both) } })) as typeof fetch;
    const result = await checkEndpoint("https://api.example.com/data", { fetcher: mixed });
    expect(passed(result)).toBe(true);
    expect(result.findings.some((finding) => finding.detail.includes("not-an-address"))).toBe(false);
  });

  it("fails a Solana payout that has no USDC account", async () => {
    const solana = { ...good, accepts: [{ scheme: "exact", network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", amount: "1000", asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", payTo: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM" }] };
    const fetcher = (async () => new Response(null, { status: 402, headers: { "PAYMENT-REQUIRED": header(solana) } })) as typeof fetch;
    const missing = await checkEndpoint("https://api.example.com/data", { fetcher, tokenAccount: async () => false });
    expect(passed(missing)).toBe(false);
    const present = await checkEndpoint("https://api.example.com/data", { fetcher, tokenAccount: async () => true });
    expect(passed(present)).toBe(true);
    let lookups = 0;
    const unknown = await checkEndpoint("https://api.example.com/data", { fetcher, tokenAccount: async () => { lookups += 1; return undefined; } });
    expect(passed(unknown)).toBe(false);
    expect(lookups).toBe(2);
  });

  it("formats USDC units and rejects non-base64 headers", () => {
    expect(formatUsdc("1000")).toBe("0.001");
    expect(formatUsdc("2500000")).toBe("2.5");
    expect(() => decodePaymentRequired("%%%")).toThrow("base64");
  });
});
