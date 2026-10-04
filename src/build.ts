import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { isEvmAddress, isSolanaAddress } from "./x402.js";

export const X402_VERSION = "2.28.0";
export const COINBASE_X402_VERSION = "2.1.0";
export const EXPRESS_VERSION = "5.2.1";
export const X402_MQTT_VERSION = "0.2.0";
export const MQTT_VERSION = "5.16.0";
export const TESTNET_FACILITATOR = "https://x402.org/facilitator";

export type Rail = "base" | "solana";

export interface X402Answers {
  name: string;
  rails: Rail[];
  price: string;
  description: string;
  payToBase?: string | undefined;
  payToSolana?: string | undefined;
  mainnet: boolean;
}

export interface MachineAnswers {
  name: string;
  device: "mac" | "linux";
  payout: string;
  price: string;
  mainnet: boolean;
  broker?: string | undefined;
  network?: Rail | undefined;
  solanaPayout?: string | undefined;
}

export type Files = Record<string, string>;

export function validName(name: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,62}$/.test(name);
}

export function validPrice(price: string): boolean {
  return /^\d+(\.\d{1,6})?$/.test(price) && Number(price) > 0;
}

export function validEvmAddress(value: string): boolean {
  return isEvmAddress(value);
}

export function validBroker(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol === "mqtts:" || url.protocol === "wss:") return Boolean(url.hostname);
  if (url.protocol !== "mqtt:" && url.protocol !== "ws:") return false;
  return url.hostname === "localhost" || url.hostname === "[::1]" || /^127\.\d+\.\d+\.\d+$/.test(url.hostname);
}

export function validSolanaAddress(value: string): boolean {
  return isSolanaAddress(value);
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function envFile(lines: [string, string][]): string {
  return `${lines.map(([key, value]) => `${key}=${value}`).join("\n")}\n`;
}

export function x402Files(answers: X402Answers): Files {
  const base = answers.rails.includes("base");
  const solana = answers.rails.includes("solana");
  if (!base && !solana) throw new Error("choose Base, Solana or both");
  if (base && (!answers.payToBase || !validEvmAddress(answers.payToBase))) throw new Error("Base payout must be a 0x address");
  if (solana && (!answers.payToSolana || !validSolanaAddress(answers.payToSolana))) throw new Error("Solana payout must be a Solana address");
  if (!validPrice(answers.price)) throw new Error("price must be a USD amount like 0.001");

  const dependencies: Record<string, string> = {
    "@coinbase/x402": COINBASE_X402_VERSION,
    "@x402/core": X402_VERSION,
    ...(base ? { "@x402/evm": X402_VERSION } : {}),
    "@x402/express": X402_VERSION,
    "@x402/extensions": X402_VERSION,
    ...(solana ? { "@x402/svm": X402_VERSION } : {}),
    express: EXPRESS_VERSION
  };

  const imports = [
    'import express from "express";',
    'import { paymentMiddleware, x402ResourceServer } from "@x402/express";',
    'import { HTTPFacilitatorClient } from "@x402/core/server";',
    'import { declareDiscoveryExtension } from "@x402/extensions/bazaar";',
    'import { facilitator as coinbase } from "@coinbase/x402";',
    ...(base ? ['import { ExactEvmScheme } from "@x402/evm/exact/server";'] : []),
    ...(solana ? ['import { ExactSvmScheme } from "@x402/svm/exact/server";'] : [])
  ];

  const index = `${imports.join("\n")}

try {
  process.loadEnvFile();
} catch {}

const mainnet = process.env.X402_NETWORK === "mainnet";
const port = Number(process.env.PORT ?? 4021);
${base ? 'const baseNetwork = mainnet ? "eip155:8453" : "eip155:84532";\n' : ""}${solana ? 'const solanaNetwork = mainnet ? "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" : "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";\n' : ""}
if (mainnet && (!process.env.CDP_API_KEY_ID || !process.env.CDP_API_KEY_SECRET)) {
  console.error("Mainnet needs CDP_API_KEY_ID and CDP_API_KEY_SECRET in .env (https://portal.cdp.coinbase.com)");
  process.exit(1);
}

const accepts = [
${base ? '  { scheme: "exact", price: process.env.PRICE, network: baseNetwork, payTo: process.env.PAY_TO_BASE },\n' : ""}${solana ? '  { scheme: "exact", price: process.env.PRICE, network: solanaNetwork, payTo: process.env.PAY_TO_SOLANA },\n' : ""}];

const facilitator = new HTTPFacilitatorClient(mainnet ? coinbase : { url: "${TESTNET_FACILITATOR}" });
const server = new x402ResourceServer(facilitator)${base ? "\n  .register(baseNetwork, new ExactEvmScheme())" : ""}${solana ? "\n  .register(solanaNetwork, new ExactSvmScheme())" : ""};

const app = express();

app.use(
  paymentMiddleware(
    {
      "GET /data": {
        accepts,
        description: process.env.DESCRIPTION,
        mimeType: "application/json",
        extensions: {
          ...declareDiscoveryExtension({
            output: { example: { message: "hello from ${answers.name}", at: "2026-01-01T00:00:00.000Z" } }
          })
        }
      }
    },
    server
  )
);

app.get("/data", (_request, response) => {
  response.json({ message: "hello from ${answers.name}", at: new Date().toISOString() });
});

app.listen(port, () => {
  console.log(\`${answers.name} selling GET /data on \${mainnet ? "mainnet" : "testnet"} · http://localhost:\${port}/data\`);
});
`;

  const env: [string, string][] = [
    ["X402_NETWORK", answers.mainnet ? "mainnet" : "testnet"],
    ["PRICE", `$${answers.price}`],
    ["DESCRIPTION", `"${answers.description.replace(/["\\\r\n]/g, " ").trim()}"`],
    ...(base ? [["PAY_TO_BASE", answers.payToBase!] as [string, string]] : []),
    ...(solana ? [["PAY_TO_SOLANA", answers.payToSolana!] as [string, string]] : []),
    ["CDP_API_KEY_ID", ""],
    ["CDP_API_KEY_SECRET", ""]
  ];

  const rails = [base ? "Base" : "", solana ? "Solana" : ""].filter(Boolean).join(" and ");
  const readme = `# ${answers.name}

A paid x402 API on ${rails}, built with \`cult build x402\` from Coinbase's official x402 Express example.

\`\`\`bash
npm install
npm start
cult check http://localhost:4021/data
\`\`\`

- \`GET /data\` costs $${answers.price} USDC. Edit the handler in \`index.mjs\` to sell your own data.
- \`.env\` holds the network, price and payout addresses. It starts on testnet with the free x402.org facilitator.
- To go live, set \`X402_NETWORK=mainnet\` and add \`CDP_API_KEY_ID\` and \`CDP_API_KEY_SECRET\` from https://portal.cdp.coinbase.com.
${solana ? "- A Solana payout must have held USDC at least once, or payments to it fail. `cult check` tells you.\n" : ""}- Deploy it anywhere Node runs, then run \`cult check https://your-domain/data\` and \`cult handshake https://your-domain/data\` for the first sale. Marketplaces list a seller after its first settlement.
`;

  return {
    "package.json": json({
      name: answers.name,
      private: true,
      type: "module",
      engines: { node: ">=20.12" },
      scripts: { start: "node index.mjs" },
      dependencies
    }),
    "index.mjs": index,
    ".env": envFile(env),
    ".env.example": envFile(env.map(([key, value]) => [key, key.startsWith("CDP_") ? "" : value])),
    ".gitignore": "node_modules\n.env\n",
    "README.md": readme
  };
}

const linuxPublisher = `import { readFileSync } from "node:fs";
import mqtt from "mqtt";

const device = process.env.DEVICE ?? "server";
const client = mqtt.connect(process.env.BROKER_URL, { username: process.env.MQTT_USERNAME, password: process.env.MQTT_PASSWORD });

function publish(topic, value, unit) {
  client.publish(\`raw/\${device}/\${topic}\`, JSON.stringify({ value, unit, ts: Date.now() }));
}

setInterval(() => {
  const uptime = Number(readFileSync("/proc/uptime", "utf8").split(" ")[0]);
  const load = Number(readFileSync("/proc/loadavg", "utf8").split(" ")[0]);
  const memory = Object.fromEntries(readFileSync("/proc/meminfo", "utf8").split("\\n").filter(Boolean).map(line => {
    const [key, value] = line.split(":");
    return [key, parseInt(value, 10)];
  }));
  publish("uptime", Number((uptime / 86_400).toFixed(2)), "days");
  publish("cpu/load", load, "load");
  publish("memory/used", Math.round((1 - memory.MemAvailable / memory.MemTotal) * 100), "%");
}, 10_000);
`;

export function machineFiles(answers: MachineAnswers): Files {
  const rail = answers.network ?? "base";
  if (rail !== "base" && rail !== "solana") throw new Error("--network must be base or solana");
  if (rail === "solana" ? !validSolanaAddress(answers.payout) : !validEvmAddress(answers.payout)) {
    throw new Error(rail === "solana" ? "payout must be a Solana address" : "payout must be a 0x address on Base");
  }
  if (answers.solanaPayout !== undefined && (rail !== "base" || !validSolanaAddress(answers.solanaPayout))) {
    throw new Error("--solana-payout needs a Solana address alongside a Base payout");
  }
  if (!answers.mainnet && (rail === "solana" || answers.solanaPayout !== undefined)) {
    throw new Error("Solana machines require mainnet");
  }
  if (!validPrice(answers.price)) throw new Error("price must be a USD amount like 0.001");
  const network = rail === "solana" ? "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" : answers.mainnet ? "eip155:8453" : "eip155:84532";
  const facilitator = answers.mainnet ? "coinbase" : TESTNET_FACILITATOR;
  const solana = answers.solanaPayout ? { solanaPayout: answers.solanaPayout } : {};
  const cli = "node --env-file=.env node_modules/@cultos/x402-mqtt/dist/cli.js";

  if (answers.device === "mac") {
    return {
      "package.json": json({
        name: answers.name,
        private: true,
        type: "module",
        engines: { node: ">=20.12" },
        scripts: { start: `${cli} sell` },
        dependencies: { "@cultos/x402-mqtt": X402_MQTT_VERSION }
      }),
      "x402-mqtt.json": json({ payout: answers.payout, network, ...solana, facilitator, source: "mac", price: answers.price, ledger: "x402-mqtt-ledger.jsonl", pagePort: 4020 }),
      ".env": envFile([["CDP_API_KEY_ID", ""], ["CDP_API_KEY_SECRET", ""]]),
      ".gitignore": "node_modules\n.env\nx402-mqtt-ledger.jsonl\n",
      "README.md": `# ${answers.name}

This Mac sells its battery, power, CPU, memory and thermal readings over MQTT, built with \`cult build machine\` on \`@cultos/x402-mqtt\`.

\`\`\`bash
npm install
npm start
\`\`\`

- It runs a built-in broker on \`mqtt://127.0.0.1:1883\` and a sales page on http://127.0.0.1:4020.
- ${answers.mainnet ? "Mainnet: add CDP_API_KEY_ID and CDP_API_KEY_SECRET to .env (https://portal.cdp.coinbase.com)." : "Testnet with the free x402.org facilitator. For mainnet, set network to eip155:8453 and facilitator to coinbase in x402-mqtt.json, and add the CDP keys to .env."}
- ${answers.solanaPayout ? `Base payouts go to ${answers.payout}; Solana payouts go to ${answers.solanaPayout}.` : `Sales go to ${answers.payout}.`} Buyers pay $${answers.price} per reading.
${rail === "solana" || answers.solanaPayout ? "- Solana payouts need an existing USDC account.\n" : ""}
- First sale, on mainnet, from a small-balance buyer wallet: run \`read -rs X402_MQTT_BUYER_KEY && export X402_MQTT_BUYER_KEY\` so the key stays out of your shell history, then \`cult handshake mac/cpu/load --broker mqtt://127.0.0.1:1883\`.
`
    };
  }

  if (!answers.broker) throw new Error("a Linux machine needs a broker URL");
  if (!validBroker(answers.broker)) throw new Error("a remote broker must use mqtts:// or wss://; plain mqtt:// or ws:// only on this machine");
  const offers = [
    { topic: "server/uptime", price: answers.price, unit: "days", description: "Days since boot" },
    { topic: "server/cpu/load", price: answers.price, unit: "load", description: "CPU load, 1-minute average" },
    { topic: "server/memory/used", price: answers.price, unit: "%", description: "Memory in use" }
  ];
  return {
    "package.json": json({
      name: answers.name,
      private: true,
      type: "module",
      engines: { node: ">=20.12" },
      scripts: { start: `${cli} sell`, publish: "node --env-file=.env publisher.mjs" },
      dependencies: { "@cultos/x402-mqtt": X402_MQTT_VERSION, mqtt: MQTT_VERSION }
    }),
    "x402-mqtt.json": json({ broker: answers.broker, brokerUsername: "x402-bridge", brokerPassword: "set-your-bridge-password", payout: answers.payout, network, ...solana, facilitator, price: answers.price, offers, ledger: "x402-mqtt-ledger.jsonl", pagePort: false }),
    "publisher.mjs": linuxPublisher,
    ".env": envFile([["BROKER_URL", answers.broker], ["MQTT_USERNAME", "server"], ["MQTT_PASSWORD", ""], ["DEVICE", "server"], ["CDP_API_KEY_ID", ""], ["CDP_API_KEY_SECRET", ""]]),
    ".gitignore": "node_modules\n.env\nx402-mqtt.json\nx402-mqtt-ledger.jsonl\n",
    "README.md": `# ${answers.name}

This Linux server sells its uptime, CPU load and memory over MQTT, built with \`cult build machine\` on \`@cultos/x402-mqtt\`.

It needs a broker with two users: \`x402-bridge\` for the seller and \`server\` for the publisher. Use the Mosquitto access rules in https://github.com/thesmithdao/x402-mqtt/tree/main/examples/mosquitto. Use \`mqtts://\` or \`wss://\` unless the broker runs on this machine.

\`\`\`bash
npm install
npm run publish   # sends readings to the broker every 10 seconds
npm start         # sells them
\`\`\`

- Set the bridge password in \`x402-mqtt.json\` and the publisher password in \`.env\`. Both files stay out of Git.
- ${answers.mainnet ? "Mainnet: add CDP_API_KEY_ID and CDP_API_KEY_SECRET to .env." : "Testnet with the free x402.org facilitator. For mainnet, set network to eip155:8453 and facilitator to coinbase in x402-mqtt.json, and add the CDP keys to .env."}
- ${answers.solanaPayout ? `Base payouts go to ${answers.payout}; Solana payouts go to ${answers.solanaPayout}.` : `Sales go to ${answers.payout}.`} Buyers pay $${answers.price} per reading.
${rail === "solana" || answers.solanaPayout ? "- Solana payouts need an existing USDC account.\n" : ""}
`
  };
}

export function writeProject(directory: string, files: Files): string {
  const root = resolve(directory);
  if (existsSync(root) && readdirSync(root).length > 0) throw new Error(`${root} is not empty; choose a new folder`);
  mkdirSync(root, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const path = join(root, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, { flag: "wx", mode: name === ".env" || name === "x402-mqtt.json" ? 0o600 : 0o644 });
  }
  return root;
}
