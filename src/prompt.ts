import { createInterface } from "node:readline/promises";
import pc from "picocolors";

export interface Asker {
  ask(question: string, fallback?: string): Promise<string>;
  confirm(question: string, defaultYes?: boolean): Promise<boolean>;
  choose(question: string, options: string[]): Promise<number>;
}

export function interactiveTerminal(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

async function question(text: string): Promise<string> {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await prompt.question(text)).trim();
  } finally {
    prompt.close();
  }
}

export const terminal: Asker = {
  async ask(text, fallback) {
    const answer = await question(`${text}${fallback ? pc.dim(` (${fallback})`) : ""} `);
    return answer || fallback || "";
  },
  async confirm(text, defaultYes = false) {
    const answer = (await question(`${text} ${defaultYes ? "[Y/n]" : "[y/N]"} `)).toLowerCase();
    if (!answer) return defaultYes;
    return ["y", "yes"].includes(answer);
  },
  async choose(text, options) {
    console.log(text);
    options.forEach((option, index) => console.log(`  ${pc.bold(String(index + 1))}  ${option}`));
    for (;;) {
      const answer = Number.parseInt(await question(`Choose 1-${options.length}: `), 10);
      if (Number.isInteger(answer) && answer >= 1 && answer <= options.length) return answer - 1;
      console.log(pc.yellow(`Type a number from 1 to ${options.length}.`));
    }
  }
};
