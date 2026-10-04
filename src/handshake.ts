import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pc from "picocolors";
import { safe } from "./display.js";
import { commandExists } from "./github.js";
import { validBroker, X402_MQTT_VERSION, type Rail } from "./build.js";
import { checkEndpoint, decodeBase64, formatUsdc, isEvmAddress, isLocal, isSolanaAddress, networkOf, passed, solanaRpcFor, type Accept, type CheckResult, type Finding, type TokenAccountLookup } from "./x402.js";

export const AWAL_VERSION = "2.12.1";
export const DEFAULT_CAP = "0.01";

export interface HandshakeOptions {
  method?: string | undefined;
  data?: string | undefined;
  max?: string | undefined;
  broker?: string | undefined;
  yes?: boolean | undefined;
  payTo?: string | undefined;
  checkOnly?: boolean | undefined;
  confirm: (question: string) => Promise<boolean>;
  fetcher?: typeof fetch | undefined;
  tokenAccount?: TokenAccountLookup | undefined;
  network?: string | undefined;
}

export function capUnits(max: string): bigint {
  if (!/^\d+(\.\d{1,6})?$/.test(max)) throw new Error("--max must be a USD amount like 0.01");
  const [whole, fraction = ""] = max.split(".");
  return BigInt(whole!) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
}

export function printFindings(result: CheckResult): void {
  const marker = (finding: Finding) => finding.level === "pass" ? pc.green("●") : finding.level === "warn" ? pc.yellow("○") : pc.red("✕");
  for (const finding of result.findings) {
    const text = safe(finding.detail);
    const detail = finding.level === "fail" ? pc.red(text) : finding.level === "warn" ? pc.yellow(text) : pc.dim(text);
    console.log(`${marker(finding)} ${safe(finding.label).padEnd(14)} ${detail}`);
  }
}

export function explorer(networkId: string, transaction: string): string | undefined {
  if (networkId === "eip155:8453" && /^0x[0-9a-fA-F]{64}$/.test(transaction)) return `https://basescan.org/tx/${transaction}`;
  if (networkId === "eip155:84532" && /^0x[0-9a-fA-F]{64}$/.test(transaction)) return `https://sepolia.basescan.org/tx/${transaction}`;
  if (networkId === "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" && /^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(transaction)) return `https://solscan.io/tx/${transaction}`;
  if (networkId === "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1" && /^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(transaction)) return `https://solscan.io/tx/${transaction}?cluster=devnet`;
  return undefined;
}

export function isTransactionFor(networkId: string, transaction: string): boolean {
  const network = networkOf(networkId);
  if (!network) return false;
  return network.family === "evm"
    ? /^0x[0-9a-fA-F]{64}$/.test(transaction)
    : /^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(transaction);
}

export function findTransaction(value: unknown): string | undefined {
  if (typeof value === "string") {
    return /^0x[0-9a-fA-F]{64}$/.test(value) || /^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(value) ? value : undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ["transaction", "txHash", "transactionHash", "signature"]) {
    const found = findTransaction(record[key]);
    if (found) return found;
  }
  for (const item of Object.values(record)) {
    if (item && typeof item === "object") {
      const found = findTransaction(item);
      if (found) return found;
    }
  }
  return undefined;
}

export function settlementOf(headers: Record<string, string> | undefined): { success?: boolean; transaction?: string; network?: string } | undefined {
  const value = headers && Object.entries(headers).find(([key]) => key.toLowerCase() === "payment-response")?.[1];
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(decodeBase64(value).toString("utf8")) as { success?: unknown; transaction?: unknown; network?: unknown };
    return {
      ...(typeof parsed.success === "boolean" ? { success: parsed.success } : {}),
      ...(typeof parsed.transaction === "string" ? { transaction: parsed.transaction } : {}),
      ...(typeof parsed.network === "string" ? { network: parsed.network } : {})
    };
  } catch {
    return undefined;
  }
}

export async function listingStatus(target: string, fetcher: typeof fetch = fetch): Promise<string> {
  const url = new URL(target);
  if (isLocal(url)) return "local only: deploy it, then its first sale gets it listed";
  const id = url.hostname.replace(/\./g, "-");
  try {
    const response = await fetcher(`https://api.agentic.market/v1/services/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(15_000) });
    if (response.status === 404) return "not on Agentic Market yet: marketplaces list a seller after its first settlement, which can take a while";
    if (!response.ok) return `Agentic Market unavailable (${response.status})`;
    const service = await response.json() as { endpoints?: { url?: string }[] };
    const path = `${url.origin}${url.pathname}`;
    return service.endpoints?.some((endpoint) => endpoint.url === path)
      ? "listed on Agentic Market"
      : "this domain is on Agentic Market, this endpoint not yet";
  } catch {
    return "Agentic Market unreachable";
  }
}

function affordable(accepts: Accept[], cap: bigint): Accept[] {
  return accepts.filter((accept) => accept.scheme === "exact" && networkOf(accept.network)?.testnet === false && /^[1-9]\d{0,17}$/.test(accept.amount) && BigInt(accept.amount) <= cap);
}

function describe(accept: Accept): string {
  return `${formatUsdc(accept.amount)} USDC on ${networkOf(accept.network)?.name ?? accept.network} to ${accept.payTo}`;
}

function quote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function payCommand(url: string, method: string, data: string | undefined, cap: bigint): string {
  const body = data ? ` -d ${quote(data)}` : "";
  return `npx awal@${AWAL_VERSION} x402 pay ${quote(url)} -X ${quote(method)}${body} --max-amount ${cap} --scheme exact`;
}

export const BASE_RPC = "https://mainnet.base.org";
export const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const transferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

async function rpcCall(rpc: string, method: string, params: unknown[], fetcher: typeof fetch): Promise<unknown> {
  try {
    const response = await fetcher(rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(15_000)
    });
    if (!response.ok) return undefined;
    return (await response.json() as { result?: unknown }).result;
  } catch {
    return undefined;
  }
}

export interface SettlementReceipt {
  settled: boolean;
  reason?: string;
  payer?: string;
  payee?: string;
  amount?: string;
}

export interface SaleTerms {
  units: bigint;
  payTo: string;
  payer?: string | undefined;
}

export interface AwalAddresses {
  evm?: string | undefined;
  solana?: string | undefined;
}

export function awalAddresses(): AwalAddresses {
  const asked = spawnSync("awal", ["address", "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 });
  if (asked.status !== 0) return {};
  let reported: unknown;
  try {
    reported = JSON.parse(asked.stdout.trim());
  } catch {
    return {};
  }
  const record = reported && typeof reported === "object" ? reported as Record<string, unknown> : {};
  const named = [record.evm, record.solana, record.address, reported].filter((value): value is string => typeof value === "string");
  const evm = named.find(isEvmAddress);
  const solana = named.find(isSolanaAddress);
  return { ...(evm ? { evm } : {}), ...(solana ? { solana } : {}) };
}

export const MACHINE_CONFIG = "x402-mqtt.json";

function machineConfig(folder: string = process.cwd()): { network?: unknown; payout?: unknown; solanaPayout?: unknown } {
  try {
    const config: unknown = JSON.parse(readFileSync(join(folder, MACHINE_CONFIG), "utf8"));
    return config && typeof config === "object" && !Array.isArray(config) ? config : {};
  } catch {
    return {};
  }
}

function machineNetwork(flag?: string) {
  const selected = flag ?? machineConfig().network ?? "base";
  if (flag !== undefined && flag !== "base" && flag !== "solana") throw new Error("--network must be base or solana");
  const id = selected === "base" ? "eip155:8453" : selected === "solana" ? "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" : selected;
  const network = typeof id === "string" ? networkOf(id) : undefined;
  if (!network || network.testnet) throw new Error("a machine first sale requires Base or Solana mainnet");
  return network;
}

export function configuredPayout(folder: string = process.cwd(), rail: Rail = "base"): string | undefined {
  const config = machineConfig(folder);
  const primarySolana = config.network === "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
  if (rail === "base" && primarySolana) return undefined;
  const payout = rail === "solana" && !primarySolana ? config.solanaPayout : config.payout;
  return typeof payout === "string" && (rail === "solana" ? isSolanaAddress(payout) : isEvmAddress(payout)) ? payout : undefined;
}

export function salePayout(flag: string | undefined, folder?: string, rail: Rail = "base"): string | undefined {
  if (flag === undefined) return configuredPayout(folder, rail);
  if (rail === "solana" ? !isSolanaAddress(flag) : !isEvmAddress(flag)) {
    throw new Error(rail === "solana" ? "--pay-to must be a Solana address" : "--pay-to must be a 0x address on Base that is not the zero address");
  }
  return flag;
}

export async function confirmOnBase(
  transaction: string,
  sale: SaleTerms,
  fetcher: typeof fetch = fetch,
  attempts = 5
): Promise<SettlementReceipt> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 2_000));
    const receipt = await rpcCall(BASE_RPC, "eth_getTransactionReceipt", [transaction], fetcher) as
      { status?: unknown; logs?: unknown } | null | undefined;
    if (!receipt) continue;
    if (receipt.status !== "0x1") return { settled: false, reason: "the transaction reverted on Base" };

    const logs = Array.isArray(receipt.logs) ? receipt.logs : [];
    const transfers = logs.flatMap((log) => {
      const entry = log as { address?: unknown; topics?: unknown; data?: unknown };
      const topics = Array.isArray(entry.topics) ? entry.topics : [];
      if (typeof entry.address !== "string" || entry.address.toLowerCase() !== BASE_USDC.toLowerCase()) return [];
      if (typeof topics[0] !== "string" || topics[0].toLowerCase() !== transferTopic) return [];
      if (typeof topics[1] !== "string" || typeof topics[2] !== "string") return [];
      if (typeof entry.data !== "string" || !/^0x[0-9a-fA-F]+$/.test(entry.data)) return [];
      return [{
        from: `0x${topics[1].slice(-40)}`,
        to: `0x${topics[2].slice(-40)}`,
        value: BigInt(entry.data)
      }];
    });

    if (transfers.length === 0) return { settled: false, reason: "no USDC transfer in that transaction" };
    const matched = transfers.find((transfer) =>
      transfer.value === sale.units
      && transfer.to.toLowerCase() === sale.payTo.toLowerCase()
      && (!sale.payer || transfer.from.toLowerCase() === sale.payer.toLowerCase()));
    if (!matched) {
      return { settled: false, reason: unmatched(sale) };
    }
    return {
      settled: true,
      payer: matched.from,
      payee: matched.to,
      amount: matched.value.toString()
    };
  }
  return { settled: false, reason: `no receipt on Base mainnet for ${transaction}` };
}

interface TokenMove {
  owner: string;
  delta: bigint;
}

function tokenMoves(before: unknown, after: unknown, mint: string): TokenMove[] {
  const held = (value: unknown) => (Array.isArray(value) ? value : []).flatMap((entry) => {
    const balance = entry as { accountIndex?: unknown; mint?: unknown; owner?: unknown; uiTokenAmount?: { amount?: unknown } };
    const amount = balance.uiTokenAmount?.amount;
    if (balance.mint !== mint || typeof balance.owner !== "string" || typeof balance.accountIndex !== "number") return [];
    if (typeof amount !== "string" || !/^\d+$/.test(amount)) return [];
    return [{ index: balance.accountIndex, owner: balance.owner, amount: BigInt(amount) }];
  });
  const opening = new Map(held(before).map((entry) => [entry.index, entry.amount]));
  return held(after).map((entry) => ({ owner: entry.owner, delta: entry.amount - (opening.get(entry.index) ?? 0n) }));
}

function unmatched(sale: SaleTerms): string {
  const payment = `USDC transfer of ${formatUsdc(sale.units.toString())} to ${sale.payTo}`;
  return sale.payer
    ? `no ${payment} from ${sale.payer} in that transaction`
    : `no ${payment} in that transaction`;
}

export interface SolanaSale extends SaleTerms {
  mint: string;
}

export async function confirmOnSolana(
  signature: string,
  sale: SolanaSale,
  networkId: string,
  fetcher: typeof fetch = fetch,
  attempts = 5
): Promise<SettlementReceipt> {
  const rpc = solanaRpcFor(networkId);
  if (!rpc) return { settled: false, reason: "cult has no Solana RPC for that network" };
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 2_000));
    const statuses = await rpcCall(rpc, "getSignatureStatuses", [[signature], { searchTransactionHistory: true }], fetcher) as
      { value?: ({ err?: unknown; confirmationStatus?: unknown } | null)[] } | undefined;
    const status = statuses?.value?.[0];
    if (!status) continue;
    if (status.err) return { settled: false, reason: "the transaction failed on Solana" };
    if (status.confirmationStatus !== "confirmed" && status.confirmationStatus !== "finalized") continue;

    const confirmed = await rpcCall(rpc, "getTransaction", [signature, { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: 0 }], fetcher) as
      { meta?: { preTokenBalances?: unknown; postTokenBalances?: unknown } } | null | undefined;
    if (!confirmed?.meta) continue;
    const moves = tokenMoves(confirmed.meta.preTokenBalances, confirmed.meta.postTokenBalances, sale.mint);
    const payer = moves.find((move) => move.delta === -sale.units);
    const paid = moves.some((move) => move.owner === sale.payTo && move.delta === sale.units)
      && (!sale.payer || payer?.owner === sale.payer);
    if (!paid) return { settled: false, reason: unmatched(sale) };
    return {
      settled: true,
      payee: sale.payTo,
      amount: sale.units.toString(),
      ...(payer ? { payer: payer.owner } : {})
    };
  }
  return { settled: false, reason: `no confirmed transaction on Solana for ${signature}` };
}

export async function confirmSale(accept: Accept, transaction: string, payer: string | undefined, fetcher: typeof fetch = fetch): Promise<SettlementReceipt> {
  const network = networkOf(accept.network);
  if (!network) return { settled: false, reason: "cult does not settle on that network" };
  const sale: SaleTerms = { units: BigInt(accept.amount), payTo: accept.payTo, ...(payer ? { payer } : {}) };
  if (network.family === "solana") return confirmOnSolana(transaction, { ...sale, mint: network.usdc }, network.id, fetcher);
  if (network.id !== "eip155:8453") return { settled: false, reason: `cult confirms EVM sales on Base only, not ${network.name}` };
  return confirmOnBase(transaction, sale, fetcher);
}

export async function ensureAwal(confirm: HandshakeOptions["confirm"]): Promise<boolean> {
  if (commandExists("awal")) return true;
  console.log(pc.yellow("\nThe first sale needs a payer. Coinbase's awal wallet keeps its key off this machine."));
  if (!await confirm(`Install awal ${AWAL_VERSION} now?`)) {
    console.log(pc.dim("No problem. cult handshake offers it again when you make the first sale."));
    return false;
  }
  const install = spawnSync("npm", ["install", "-g", `awal@${AWAL_VERSION}`], { stdio: "inherit", timeout: 5 * 60_000 });
  if (install.status !== 0 || !commandExists("awal")) {
    console.log(pc.red("awal installation failed"));
    return false;
  }
  console.log(pc.dim("Sign in once with: awal auth login you@example.com"));
  return true;
}

async function handshakeHttp(target: string, options: HandshakeOptions): Promise<boolean> {
  const method = (options.method ?? (options.data ? "POST" : "GET")).toUpperCase();
  if (options.checkOnly) {
    console.log(`\n${pc.bold("Listing")}  ${await listingStatus(target, options.fetcher)}\n`);
    return true;
  }
  const cap = capUnits(options.max ?? DEFAULT_CAP);
  if (new URL(target).protocol !== "https:") {
    console.log(pc.yellow("\nThe first sale needs the public https address. Payers refuse plain http, even on localhost."));
    console.log(pc.dim("Deploy it, or expose it for a test with a tunnel such as: cloudflared tunnel --url http://localhost:4021\n"));
    return false;
  }
  const result = await checkEndpoint(target, { method, data: options.data, fetcher: options.fetcher, tokenAccount: options.tokenAccount });
  console.log(pc.bold("\nCULT OS // HANDSHAKE\n"));
  printFindings(result);
  if (!passed(result) || !result.paymentRequired) {
    console.log(pc.red("\nFix the failed checks before the first sale.\n"));
    return false;
  }
  const options402 = affordable(result.paymentRequired.accepts, cap);
  if (options402.length === 0 && result.paymentRequired.accepts.some((accept) => networkOf(accept.network)?.testnet)) {
    console.log(pc.yellow("\nThis endpoint only takes testnet payments. The first sale has to be real: set X402_NETWORK=mainnet and your CDP keys, restart it, and run again.\n"));
    return false;
  }
  if (options402.length === 0) {
    console.log(pc.red(`\nEvery option costs more than the ${formatUsdc(cap.toString())} USDC cap. Raise it with --max.\n`));
    return false;
  }
  console.log(`\n${pc.bold("Pays one of")}`);
  for (const accept of options402) console.log(`  ${safe(describe(accept))}`);
  console.log(pc.dim(`  capped at ${formatUsdc(cap.toString())} USDC\n`));

  if (!await ensureAwal(options.confirm)) {
    console.log(`Pay from any x402 wallet with these terms, or run:\n  ${safe(payCommand(result.url, method, options.data, cap))}`);
    console.log(pc.dim(`Then check the listing with: cult handshake ${safe(quote(result.url))} --check\n`));
    return false;
  }
  const buyer = awalAddresses();
  const wallets = [buyer.evm, buyer.solana].filter((value): value is string => Boolean(value));
  console.log(wallets.length > 0
    ? `${pc.dim("pays from")}  ${wallets.map((wallet) => safe(wallet)).join("  ")}\n`
    : pc.dim("awal did not report its own address, so the receipt's payer cannot be checked.\n"));
  if (!options.yes && !await options.confirm("Make this real payment now?")) {
    console.log(pc.dim("No payment made.\n"));
    return false;
  }

  const args = ["x402", "pay", result.url, "-X", method, ...(options.data ? ["-d", options.data] : []), "--max-amount", cap.toString(), "--scheme", "exact", "--json"];
  console.log(pc.dim("Paying through awal…"));
  const paid = spawnSync("awal", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 3 * 60_000 });
  let output: unknown;
  try {
    output = JSON.parse(paid.stdout.trim());
  } catch {
    output = undefined;
  }
  const record = output as { status?: number; paymentMade?: boolean; headers?: Record<string, string>; error?: { message?: string } } | undefined;
  const settlement = settlementOf(record?.headers);
  if (paid.status !== 0 || record?.paymentMade !== true || settlement?.success !== true || !settlement.network) {
    const status = Number(record?.status);
    console.log(pc.red(`\nNo payment went through${Number.isInteger(status) ? ` (HTTP ${status})` : ""}.`));
    if (typeof record?.error?.message === "string") console.log(pc.dim(`awal: ${safe(record.error.message).slice(0, 300)}`));
    console.log(pc.dim("If awal is not signed in, run: awal auth login you@example.com\n"));
    return false;
  }
  const quoted = options402.find((accept) => accept.network === settlement.network);
  if (!quoted) {
    console.log(pc.red(`\nawal settled on ${safe(settlement.network)}, which is not one of the mainnet options above, so this is not a first sale.\n`));
    return false;
  }
  const candidate = settlement.transaction ?? findTransaction(output);
  const transaction = candidate && isTransactionFor(quoted.network, candidate) ? candidate : undefined;
  if (!transaction) {
    console.log(pc.red("\nThe seller reported a payment without a settlement transaction, so there is nothing to prove it."));
    console.log(pc.dim("A first sale counts once the payment settles on chain and the receipt names the transaction.\n"));
    return false;
  }
  const chain = networkOf(quoted.network)?.name ?? quoted.network;
  const link = explorer(quoted.network, transaction);
  console.log(pc.dim(`Confirming the receipt on ${chain}…`));
  const payer = networkOf(quoted.network)?.family === "solana" ? buyer.solana : buyer.evm;
  const receipt = await confirmSale(quoted, transaction, payer, options.fetcher);
  if (!receipt.settled) {
    console.log(pc.red(`\n${chain} does not confirm that transaction as this sale: ${safe(receipt.reason ?? "unknown")}.`));
    console.log(pc.dim("The PAYMENT-RESPONSE header comes from the seller, so the chain decides whether a sale happened, not the header."));
    if (payer) console.log(pc.dim(`The payer had to be ${safe(payer)}, which is what awal reported as its own address.`));
    console.log(pc.dim("If money did leave your wallet, the explorer is the place to look:"));
    console.log(`${pc.dim("tx")}  ${link ?? safe(transaction)}\n`);
    return false;
  }
  const done = Number(record?.status);
  console.log(pc.green(`\nFirst sale done on ${chain}${Number.isInteger(done) ? ` · HTTP ${done}` : ""}`));
  console.log(`${pc.dim("settled")}  ${formatUsdc(receipt.amount ?? quoted.amount)} USDC from ${safe(receipt.payer ?? "the buyer")} to ${safe(receipt.payee ?? quoted.payTo)}`);
  console.log(`${pc.dim("tx")}  ${link ?? safe(transaction)}`);
  console.log(`${pc.dim("listing")}  ${await listingStatus(result.url, options.fetcher)}\n`);
  return true;
}

async function handshakeMqtt(topic: string, options: HandshakeOptions): Promise<boolean> {
  if (options.checkOnly) {
    console.log(pc.dim("\nMachines are not listed on HTTP marketplaces, so there is nothing to check. No payment made.\n"));
    return true;
  }
  const broker = options.broker ?? "mqtt://127.0.0.1:1883";
  const max = options.max ?? DEFAULT_CAP;
  capUnits(max);
  if (topic.startsWith("-")) throw new Error(`Invalid machine topic: ${topic}`);
  if (!validBroker(broker)) {
    throw new Error("a remote broker must use mqtts:// or wss://; plain mqtt:// or ws:// only on this machine");
  }
  const network = machineNetwork(options.network);
  const rail: Rail = network.family === "solana" ? "solana" : "base";
  const payTo = salePayout(options.payTo, undefined, rail);
  console.log(pc.bold("\nCULT OS // HANDSHAKE\n"));
  console.log(`${pc.dim("topic")}   ${safe(topic)}\n${pc.dim("broker")}  ${safe(broker)}\n${pc.dim("network")} ${network.name}\n${pc.dim("cap")}     ${max} USDC`);
  if (!payTo) {
    console.log(pc.yellow("\nA first sale has to prove where the money landed, so it needs the machine's payout address."));
    console.log(pc.dim(`Run this inside the project cult build machine made, which records payout in ${MACHINE_CONFIG}, or pass --pay-to <address>.\n`));
    return false;
  }
  console.log(`${pc.dim("payout")}  ${payTo}\n`);
  if (!process.env.X402_MQTT_BUYER_KEY) {
    console.log(pc.yellow("Machines are paid with your own small-balance buyer wallet. Load its key without typing it into your shell history, then run again:"));
    console.log("  read -rs X402_MQTT_BUYER_KEY && export X402_MQTT_BUYER_KEY");
    console.log(pc.dim(`cult never stores it; x402-mqtt signs locally for USDC on ${network.name}.\n`));
    return false;
  }
  if (!options.yes && !await options.confirm("Make this real payment now?")) {
    console.log(pc.dim("No payment made.\n"));
    return false;
  }
  const bought = spawnSync("npx", ["--yes", `@cultos/x402-mqtt@${X402_MQTT_VERSION}`, "buy", topic, "--network", rail, "--broker", broker, "--max", max], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 3 * 60_000 });
  const output = `${bought.stdout ?? ""}\n${bought.stderr ?? ""}`;
  const paid = (bought.stdout ?? "").match(/^paid \$([0-9]+(?:\.[0-9]{1,6})?) · (.*) · tx (\S+)$/m);
  const transaction = paid?.[3];
  if (bought.status !== 0 || !transaction || !isTransactionFor(network.id, transaction)) {
    const reason = output.split("\n").map((line) => safe(line).trim()).filter(Boolean).pop();
    console.log(pc.red("\nThe machine purchase was not confirmed."));
    if (reason) console.log(pc.dim(`x402-mqtt: ${reason.slice(0, 300)}`));
    console.log(pc.dim("If the purchase is pending, rerun the same command to resume it.\n"));
    return false;
  }
  const reported = paid?.[1];
  if (!reported || capUnits(reported) <= 0n || capUnits(reported) > capUnits(max)) {
    console.log(pc.red("\nx402-mqtt did not report what it paid, so the receipt cannot be matched to the sale.\n"));
    return false;
  }
  console.log(pc.dim(`Confirming the receipt on ${network.name}…`));
  const sale = { units: capUnits(reported), payTo };
  const receipt = rail === "solana"
    ? await confirmOnSolana(transaction, { ...sale, mint: network.usdc }, network.id, options.fetcher)
    : await confirmOnBase(transaction, sale, options.fetcher);
  if (!receipt.settled) {
    console.log(pc.red(`\nx402-mqtt reported a payment that ${network.name} does not confirm: ${safe(receipt.reason ?? "unknown")}.`));
    console.log(`${pc.dim("tx")}  ${explorer(network.id, transaction) ?? safe(transaction)}\n`);
    return false;
  }
  console.log(pc.green(`\nFirst sale done on ${network.name}`));
  console.log(pc.dim(safe(`paid $${reported} · ${paid?.[2] ?? ""}`)));
  if (receipt.amount) {
    console.log(`${pc.dim("settled")}  ${formatUsdc(receipt.amount)} USDC from ${safe(receipt.payer ?? "")} to ${safe(receipt.payee ?? "")}`);
  }
  console.log(`${pc.dim("tx")}  ${explorer(network.id, transaction)}\n`);
  return true;
}

export async function runHandshake(target: string, options: HandshakeOptions): Promise<boolean> {
  if (/^https?:\/\//i.test(target) && options.network !== undefined) throw new Error("--network selects a machine payment network; HTTP payments use the endpoint's quote");
  return /^https?:\/\//i.test(target) ? handshakeHttp(target, options) : handshakeMqtt(target, options);
}
