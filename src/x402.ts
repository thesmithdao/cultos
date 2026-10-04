import { z } from "zod";

export interface X402Network {
  id: string;
  name: string;
  family: "evm" | "solana";
  testnet: boolean;
  usdc: string;
}

export const networks: X402Network[] = [
  { id: "eip155:8453", name: "Base", family: "evm", testnet: false, usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
  { id: "eip155:84532", name: "Base Sepolia", family: "evm", testnet: true, usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" },
  { id: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", name: "Solana", family: "solana", testnet: false, usdc: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
  { id: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", name: "Solana Devnet", family: "solana", testnet: true, usdc: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU" }
];

export const MAX_WINDOW_SECONDS = 600;

const acceptSchema = z.object({
  scheme: z.string(),
  network: z.string(),
  amount: z.string(),
  asset: z.string(),
  payTo: z.string(),
  maxTimeoutSeconds: z.number().optional()
}).passthrough();

const paymentRequiredSchema = z.object({
  x402Version: z.number(),
  accepts: z.array(acceptSchema),
  resource: z.object({ url: z.string().optional() }).passthrough().optional(),
  extensions: z.record(z.string(), z.unknown()).optional()
}).passthrough();

export type Accept = z.infer<typeof acceptSchema>;
export type PaymentRequired = z.infer<typeof paymentRequiredSchema>;

export interface Finding {
  level: "pass" | "warn" | "fail";
  label: string;
  detail: string;
}

export interface CheckResult {
  url: string;
  status?: number;
  paymentRequired?: PaymentRequired;
  findings: Finding[];
}

export function networkOf(id: string): X402Network | undefined {
  return networks.find((network) => network.id === id);
}

export function isLocal(url: URL): boolean {
  return url.hostname === "localhost" || url.hostname === "[::1]" || /^127\.\d+\.\d+\.\d+$/.test(url.hostname);
}

export function decodeBase64(value: string): Buffer {
  if (!/^[A-Za-z0-9+/\-_]+={0,2}$/.test(value)) throw new Error("value is not base64");
  return Buffer.from(value, "base64");
}

export function decodePaymentRequired(header: string): unknown {
  let decoded: Buffer;
  try {
    decoded = decodeBase64(header);
  } catch {
    throw new Error("PAYMENT-REQUIRED header is not base64");
  }
  return JSON.parse(decoded.toString("utf8"));
}

const base58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function isEvmAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value) && !/^0x0{40}$/.test(value);
}

function base58Bytes(value: string): number {
  let number = 0n;
  for (const char of value) number = number * 58n + BigInt(base58.indexOf(char));
  let bytes = 0;
  for (; number > 0n; number >>= 8n) bytes += 1;
  return bytes + (value.length - value.replace(/^1+/, "").length);
}

export function isSolanaAddress(value: string): boolean {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value) || /^1+$/.test(value)) return false;
  return base58Bytes(value) === 32;
}

export function isSolanaSignature(value: string): boolean {
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(value) || /^1+$/.test(value)) return false;
  return base58Bytes(value) === 64;
}

function validPayTo(network: X402Network, payTo: string): boolean {
  return network.family === "evm" ? isEvmAddress(payTo) : isSolanaAddress(payTo);
}

function sameAsset(network: X402Network, asset: string): boolean {
  return network.family === "evm" ? asset.toLowerCase() === network.usdc.toLowerCase() : asset === network.usdc;
}

export function inspectAccept(accept: Accept): Finding[] {
  const findings: Finding[] = [];
  const network = networkOf(accept.network);
  const label = network?.name ?? accept.network;
  if (accept.scheme !== "exact") {
    findings.push({ level: "warn", label, detail: `scheme ${accept.scheme} is not checked and does not count toward readiness` });
    return findings;
  }
  if (!network) {
    findings.push({ level: "fail", label, detail: "network is not Base or Solana" });
    return findings;
  }
  findings.push(sameAsset(network, accept.asset)
    ? { level: "pass", label, detail: "asset is USDC" }
    : { level: "fail", label, detail: `asset ${accept.asset} is not ${network.name} USDC` });
  findings.push(validPayTo(network, accept.payTo)
    ? { level: "pass", label, detail: `pays to ${accept.payTo}` }
    : { level: "fail", label, detail: `payTo ${accept.payTo} is not a ${network.name} address` });
  findings.push(/^[1-9]\d{0,17}$/.test(accept.amount)
    ? { level: "pass", label, detail: `price ${formatUsdc(accept.amount)} USDC` }
    : { level: "fail", label, detail: `amount ${accept.amount} is not a positive whole number of units` });
  if (accept.maxTimeoutSeconds !== undefined && accept.maxTimeoutSeconds > MAX_WINDOW_SECONDS) {
    findings.push({ level: "warn", label, detail: `payment window ${accept.maxTimeoutSeconds}s is longer than ${MAX_WINDOW_SECONDS}s` });
  }
  if (network.testnet) findings.push({ level: "warn", label, detail: "testnet: switch to mainnet before going live" });
  return findings;
}

export function formatUsdc(amount: string): string {
  const units = BigInt(amount);
  const whole = units / 1_000_000n;
  const fraction = (units % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : `${whole}`;
}

export type TokenAccountLookup = (network: X402Network, owner: string) => Promise<boolean | undefined>;

export interface CheckOptions {
  method?: string | undefined;
  data?: string | undefined;
  fetcher?: typeof fetch | undefined;
  tokenAccount?: TokenAccountLookup | undefined;
}

const solanaRpc: Record<string, string> = {
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": "https://api.mainnet-beta.solana.com",
  "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1": "https://api.devnet.solana.com"
};

export function solanaRpcFor(id: string): string | undefined {
  return Object.hasOwn(solanaRpc, id) && typeof solanaRpc[id] === "string" ? solanaRpc[id] : undefined;
}

export const solanaTokenAccount: TokenAccountLookup = async (network, owner) => {
  const rpc = solanaRpcFor(network.id);
  if (!rpc) return undefined;
  try {
    const response = await fetch(rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTokenAccountsByOwner", params: [owner, { mint: network.usdc }, { encoding: "base64" }] }),
      signal: AbortSignal.timeout(10_000)
    });
    const body = await response.json() as { result?: { value?: unknown[] } };
    return Array.isArray(body.result?.value) ? body.result.value.length > 0 : undefined;
  } catch {
    return undefined;
  }
};

export async function checkEndpoint(target: string, options: CheckOptions = {}): Promise<CheckResult> {
  const findings: Finding[] = [];
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return { url: target, findings: [{ level: "fail", label: "URL", detail: "not a valid URL" }] };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { url: target, findings: [{ level: "fail", label: "URL", detail: "use http:// or https://" }] };
  }
  findings.push(url.protocol === "https:"
    ? { level: "pass", label: "TLS", detail: "https" }
    : isLocal(url)
      ? { level: "warn", label: "TLS", detail: "plain http on localhost: fine for testing only" }
      : { level: "fail", label: "TLS", detail: "plain http to a remote host: payments must use https" });

  const method = (options.method ?? (options.data ? "POST" : "GET")).toUpperCase();
  const fetcher = options.fetcher ?? fetch;
  let response: Response;
  try {
    response = await fetcher(url, {
      method,
      ...(options.data ? { headers: { "content-type": "application/json" }, body: options.data } : {}),
      redirect: "manual",
      signal: AbortSignal.timeout(15_000)
    });
  } catch (error) {
    const code = (error as { cause?: { code?: string } }).cause?.code;
    const detail = code === "ECONNREFUSED"
      ? `nothing is running at ${url.host}; start it first`
      : code === "ENOTFOUND"
        ? `${url.hostname} does not resolve`
        : error instanceof Error && error.name === "TimeoutError"
          ? "no answer within 15 seconds"
          : error instanceof Error ? error.message : "request failed";
    findings.push({ level: "fail", label: "Reachable", detail });
    return { url: url.href, findings };
  }
  await response.body?.cancel().catch(() => undefined);
  if (response.status !== 402) {
    findings.push({ level: "fail", label: "402", detail: `expected 402 Payment Required, got ${response.status}` });
    return { url: url.href, status: response.status, findings };
  }
  findings.push({ level: "pass", label: "402", detail: "asks for payment" });

  const header = response.headers.get("payment-required");
  if (!header) {
    findings.push({ level: "fail", label: "x402 v2", detail: "no PAYMENT-REQUIRED header" });
    return { url: url.href, status: 402, findings };
  }
  let parsed: PaymentRequired;
  try {
    parsed = paymentRequiredSchema.parse(decodePaymentRequired(header));
  } catch {
    findings.push({ level: "fail", label: "x402 v2", detail: "PAYMENT-REQUIRED header is unreadable" });
    return { url: url.href, status: 402, findings };
  }
  findings.push(parsed.x402Version === 2
    ? { level: "pass", label: "x402 v2", detail: `${parsed.accepts.length} payment ${parsed.accepts.length === 1 ? "option" : "options"}` }
    : { level: "fail", label: "x402 v2", detail: `x402Version ${parsed.x402Version}: cult checks and pays only x402 v2` });
  if (parsed.accepts.length === 0) findings.push({ level: "fail", label: "Options", detail: "no payment options" });
  if (!parsed.accepts.some((accept) => accept.scheme === "exact")) {
    findings.push({ level: "fail", label: "Options", detail: "no exact payment option: cult checks and pays only the exact scheme" });
  }
  const lookup = options.tokenAccount ?? solanaTokenAccount;
  for (const accept of parsed.accepts) {
    findings.push(...inspectAccept(accept));
    const network = networkOf(accept.network);
    if (accept.scheme === "exact" && network?.family === "solana" && validPayTo(network, accept.payTo) && sameAsset(network, accept.asset)) {
      let exists = await lookup(network, accept.payTo);
      if (exists === undefined) {
        await new Promise((resolve) => setTimeout(resolve, 750));
        exists = await lookup(network, accept.payTo);
      }
      findings.push(exists === true
        ? { level: "pass", label: network.name, detail: "payout has a USDC account" }
        : exists === false
          ? { level: "fail", label: network.name, detail: "payout has no USDC account yet, so payments to it fail: send it any amount of USDC once" }
          : { level: "fail", label: network.name, detail: "could not reach Solana to confirm the payout has a USDC account: run it again" });
    }
  }
  findings.push(hasBazaarMetadata(parsed.extensions?.bazaar)
    ? { level: "pass", label: "Bazaar", detail: "discovery metadata present" }
    : { level: "fail", label: "Bazaar", detail: "no discovery metadata, so marketplaces cannot list it: add a bazaar extension (cult build x402 includes one)" });
  return { url: url.href, status: 402, paymentRequired: parsed, findings };
}

function isObject(value: unknown): boolean {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function describesShape(value: unknown): boolean {
  return isObject(value) && Object.keys(value as object).length > 0;
}

export function hasBazaarMetadata(value: unknown): boolean {
  if (!isObject(value)) return false;
  const info = (value as { info?: unknown }).info;
  if (!isObject(info)) return false;
  const described = info as { input?: unknown; output?: unknown };
  return describesShape(described.input) || describesShape(described.output);
}

export function passed(result: CheckResult): boolean {
  return result.findings.every((finding) => finding.level !== "fail");
}
