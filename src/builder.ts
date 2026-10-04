import { basename } from "node:path";
import pc from "picocolors";
import {
  machineFiles,
  validBroker,
  validEvmAddress,
  validName,
  validPrice,
  validSolanaAddress,
  writeProject,
  x402Files,
  type Rail
} from "./build.js";
import type { Asker } from "./prompt.js";

export interface BuildFlags {
  name?: string;
  rails?: string;
  price?: string;
  description?: string;
  payToBase?: string;
  payToSolana?: string;
  payout?: string;
  device?: string;
  broker?: string;
  mainnet?: boolean;
  network?: string;
  solanaPayout?: string;
}

async function answer(asker: Asker | undefined, value: string | undefined, question: string, fallback: string | undefined, valid: (value: string) => boolean, problem: string): Promise<string> {
  if (value !== undefined) {
    if (!valid(value)) throw new Error(problem);
    return value;
  }
  if (!asker) {
    if (fallback !== undefined && valid(fallback)) return fallback;
    throw new Error(problem);
  }
  for (;;) {
    const given = await asker.ask(question, fallback);
    if (valid(given)) return given;
    console.log(pc.yellow(problem));
  }
}

function folderName(folder: string | undefined): string | undefined {
  if (!folder) return undefined;
  const name = basename(folder).toLowerCase();
  return validName(name) ? name : undefined;
}

function parseRails(value: string): Rail[] | undefined {
  const rails = value.split(",").map((item) => item.trim().toLowerCase());
  if (rails.length === 0 || rails.some((item) => item !== "base" && item !== "solana")) return undefined;
  return [...new Set(rails)] as Rail[];
}

export async function runBuildX402(folder: string | undefined, flags: BuildFlags, asker?: Asker): Promise<string> {
  console.log(pc.bold("\nCULT OS // BUILD X402\n"));
  const name = await answer(asker, flags.name, "Project name?", folderName(folder) ?? "my-x402-api", validName, "Use lowercase letters, numbers and dashes.");
  let rails: Rail[];
  if (flags.rails !== undefined) {
    const parsed = parseRails(flags.rails);
    if (!parsed) throw new Error("--rails must be base, solana or base,solana");
    rails = parsed;
  } else if (asker) {
    rails = [["base"], ["solana"], ["base", "solana"]][await asker.choose("Where do buyers pay?", ["Base", "Solana", "Base and Solana"])] as Rail[];
  } else {
    rails = ["base"];
  }
  const price = await answer(asker, flags.price, "Price per call in USD?", "0.001", validPrice, "Use a USD amount like 0.001.");
  const description = await answer(asker, flags.description, "What does it sell, in one line?", "Hello data", (value) => value.length > 0 && value.length <= 200, "Describe it in 1-200 characters.");
  const payToBase = rails.includes("base")
    ? await answer(asker, flags.payToBase, "Base payout address (0x…)?", undefined, validEvmAddress, "Use a 0x address you control. It only receives; no key is needed.")
    : undefined;
  const payToSolana = rails.includes("solana")
    ? await answer(asker, flags.payToSolana, "Solana payout address?", undefined, validSolanaAddress, "Use a Solana address you control. It only receives; no key is needed.")
    : undefined;
  const mainnet = flags.mainnet ?? false;
  const root = writeProject(folder ?? name, x402Files({ name, rails, price, description, payToBase, payToSolana, mainnet }));
  console.log(pc.green(`\n◆ ${name} built in ${root}`));
  console.log(pc.dim(`  ${mainnet ? "mainnet" : "testnet"} · ${rails.join(" + ")} · $${price} per call\n`));
  console.log(`Next:\n  cd ${folder ?? name}\n  npm install\n  npm start\n  cult check http://localhost:4021/data\n`);
  return root;
}

export async function runBuildMachine(folder: string | undefined, flags: BuildFlags, asker?: Asker): Promise<string> {
  console.log(pc.bold("\nCULT OS // BUILD MACHINE\n"));
  let device: "mac" | "linux";
  if (flags.device !== undefined) {
    if (flags.device !== "mac" && flags.device !== "linux") throw new Error("--device must be mac or linux");
    device = flags.device;
  } else if (asker) {
    device = (["mac", "linux"] as const)[await asker.choose("What machine is it?", ["This Mac", "A Linux server"])]!;
  } else {
    device = process.platform === "darwin" ? "mac" : "linux";
  }
  const name = await answer(asker, flags.name, "Project name?", folderName(folder) ?? `my-${device}`, validName, "Use lowercase letters, numbers and dashes.");
  let network: Rail = "base";
  let both = flags.solanaPayout !== undefined;
  if (flags.network !== undefined) {
    if (flags.network !== "base" && flags.network !== "solana") throw new Error("--network must be base or solana");
    network = flags.network;
  } else if (asker && !both) {
    const selected = await asker.choose("Where do buyers pay?", ["Base", "Solana", "Base and Solana"]);
    network = selected === 1 ? "solana" : "base";
    both = selected === 2;
  }
  if (network === "solana" && both) throw new Error("--solana-payout is only for a Base seller accepting both networks");
  const payout = await answer(asker, flags.payout, network === "solana" ? "Solana payout address?" : "Base payout address (0x…)?", undefined, network === "solana" ? validSolanaAddress : validEvmAddress, `Use a ${network === "solana" ? "Solana" : "0x"} address you control. It only receives; no key is needed.`);
  const solanaPayout = both ? await answer(asker, flags.solanaPayout, "Solana payout address?", undefined, validSolanaAddress, "Use a Solana address you control. It only receives; no key is needed.") : undefined;
  const price = await answer(asker, flags.price, "Price per reading in USD?", "0.001", validPrice, "Use a USD amount like 0.001.");
  const broker = device === "linux"
    ? await answer(asker, flags.broker, "Broker URL (mqtts:// or wss://)?", undefined, validBroker, "Use mqtts:// or wss:// for a remote broker, like mqtts://broker.example.com:8883. Plain mqtt:// only works on this machine.")
    : undefined;
  const mainnet = flags.mainnet ?? (network === "solana" || both);
  const root = writeProject(folder ?? name, machineFiles({ name, device, payout, price, mainnet, broker, network, solanaPayout }));
  console.log(pc.green(`\n◆ ${name} built in ${root}`));
  console.log(pc.dim(`  ${device} · ${both ? "Base + Solana" : network === "solana" ? "Solana" : "Base"} · ${mainnet ? "mainnet" : "testnet"} · $${price} per reading\n`));
  console.log(device === "mac"
    ? `Next:\n  cd ${folder ?? name}\n  npm install\n  npm start\n`
    : `Next:\n  cd ${folder ?? name}\n  set the broker passwords (see README.md)\n  npm install\n  npm run publish & npm start\n`);
  return root;
}
