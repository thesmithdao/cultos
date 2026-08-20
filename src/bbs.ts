import { spawnSync } from "node:child_process";

const ESC = "\u001b[";

const color = {
  reset: `${ESC}0m`,
  blue: `${ESC}48;2;10;38;170m`,
  red: `${ESC}48;2;178;24;18m`,
  cyan: `${ESC}48;2;72;196;205m`,
  black: `${ESC}38;2;4;16;24m`,
  white: `${ESC}38;2;245;247;255m`,
  yellow: `${ESC}38;2;255;242;76m`
};

interface DeckCommand {
  command: string;
  phase: string;
  role: string;
  description: string;
  next: string;
}

const commands: DeckCommand[] = [
  { command: "doctor", phase: "CHECK", role: "Maintainer", description: "Check GitHub + ACP.", next: "Resolve missing checks, then inspect an issue." },
  { command: "inspect <issue>", phase: "PLAN", role: "Maintainer", description: "Create work contract", next: "Review the contract, then choose a provider." },
  { command: "hire <issue> --provider <address>", phase: "HIRE", role: "Maintainer", description: "Open a provider job.", next: "Watch the job for the provider quote." },
  { command: "watch <issue>", phase: "SYNC", role: "Either", description: "Read job updates.", next: "Take the action shown by the latest job event." },
  { command: "fund <issue>", phase: "PAY", role: "Maintainer", description: "Fund quote.", next: "Watch the funded job for delivery." },
  { command: "message <issue> <text>", phase: "COMMS", role: "Either", description: "Message provider.", next: "Watch for the other party's response." },
  { command: "quote --job <id> --amount <usdc>", phase: "PROVIDER", role: "Provider", description: "Set provider price.", next: "Wait for the maintainer to fund the quote." },
  { command: "deliver --job <id> --pr <url>", phase: "PROVIDER", role: "Provider", description: "Submit a PR.", next: "Wait for verification and maintainer review." },
  { command: "verify <issue>", phase: "VERIFY", role: "Maintainer", description: "Check commit + CI.", next: "Review and merge the verified pull request." },
  { command: "settle <issue> --approve", phase: "SETTLE", role: "Maintainer", description: "Release payment.", next: "CultOS posts the settlement receipt to GitHub." },
  { command: "settle <issue> --reject", phase: "REJECT", role: "Maintainer", description: "Reject with receipt.", next: "Review the receipt and close the GitHub issue if needed." },
  { command: "jobs", phase: "INDEX", role: "Either", description: "List repo jobs.", next: "Open the relevant issue or continue its workflow." }
];

const commandNames = new Set(commands.map((item) => item.command.split(" ")[0]));
const mutatingCommands = new Set(["hire", "fund", "message", "quote", "deliver", "settle"]);

function commandAt(index: number): DeckCommand {
  return commands[index] ?? commands[0]!;
}

function plain(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

function fit(value: string, width: number): string {
  const visible = plain(value);
  if (visible.length > width) {
    return visible.slice(0, width);
  }
  return value + " ".repeat(width - visible.length);
}

function row(value: string, width: number): string {
  return `│ ${fit(value, width - 3)}│`;
}

function blueRow(value: string, width: number): string {
  const painted = value.split(color.reset).join(`${color.reset}${color.blue}${color.white}`);
  return `${color.blue}${color.white}${row(painted, width)}${color.reset}`;
}

function bar(value: string, background: string, foreground: string, width: number): string {
  return `${background}${foreground}${fit(value, width)}${color.reset}`;
}

function header(width: number, label: string): string {
  const left = " ╡ CULT OS ╞  GITHUB WORK FOR THE AGENT ECONOMY ";
  const right = ` ${label} `;
  const space = " ".repeat(Math.max(1, width - left.length - right.length));
  return `${color.red}${color.yellow}${left}${space}${color.cyan}${color.black}${right}${color.reset}`;
}

function frame(lines: string[], footer: string, width: number, height: number, label: string): string {
  const contentHeight = Math.max(1, height - 5);
  const content = lines.slice(0, contentHeight);
  while (content.length < contentHeight) content.push("");

  return [
    header(width, label),
    `${color.blue}${color.white}┌${"─".repeat(width - 2)}┐${color.reset}`,
    ...content.map((line) => blueRow(line, width)),
    `${color.blue}${color.white}└${"─".repeat(width - 2)}┘${color.reset}`,
    bar(footer, color.cyan, color.black, width),
    bar(" npm install -g @cultos/cli ", color.blue, color.yellow, width)
  ].join("\n");
}

function wrap(value: string, width: number): string[] {
  const lines: string[] = [];
  for (const sourceLine of plain(value).split(/\r?\n/)) {
    if (!sourceLine) {
      lines.push("");
      continue;
    }
    let remaining = sourceLine;
    while (remaining.length > width) {
      lines.push(remaining.slice(0, width));
      remaining = remaining.slice(width);
    }
    lines.push(remaining);
  }
  return lines;
}

export function parseCommandLine(value: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote = "";
  let escaped = false;

  for (const character of value.trim()) {
    if (escaped) {
      current += character;
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (quote) {
      if (character === quote) quote = "";
      else current += character;
    } else if (character === "\"" || character === "'") {
      quote = character;
    } else if (/\s/.test(character)) {
      if (current) {
        args.push(current);
        current = "";
      }
    } else {
      current += character;
    }
  }

  if (escaped) current += "\\";
  if (quote) throw new Error("Unclosed quote");
  if (current) args.push(current);
  return args;
}

export function validateCommand(args: string[]): string | undefined {
  const name = args[0];
  if (!name) return "Type a CultOS command";
  if (name === "cult") return "Enter the command without the cult prefix";
  if (!commandNames.has(name) || name === "ui") return `Unknown CultOS command: ${name}`;
  return undefined;
}

export function renderDeck(selected = 0, columns = 94, rows = 23): string {
  const width = Math.max(79, Math.min(columns, 100));
  const list = commands.map((item, index) => {
    const cursor = index === selected ? `${color.yellow}▶${color.reset}` : " ";
    const number = `${color.yellow}[${String(index + 1).padStart(2, "0")}]${color.reset}`;
    const description = fit(item.description, Math.max(8, width - 59));
    return `${cursor} ${number} ${fit(item.command, 35)} │ ${color.cyan}${color.black}${fit(item.phase, 8)} ${color.reset}${color.blue}${color.white}│ ${description}`;
  });

  return frame([
    "AVAILABLE COMMANDS",
    "",
    ...list,
    "",
    `${color.yellow}Type / to start${color.white}`
  ], " ↑↓ SELECT   ENTER OPEN   / COMMAND   Q QUIT ", width, rows, "TERMINAL");
}

export function renderCommand(selected = 0, columns = 94, rows = 23): string {
  const width = Math.max(72, Math.min(columns, 100));
  const item = commandAt(selected);
  return frame([
    `${color.yellow}${item.phase}${color.white} // ${item.role.toUpperCase()}`,
    "",
    `cult ${item.command}`,
    "",
    item.description,
    "",
    "NEXT",
    item.next,
    "",
    "This screen is a command reference. Press Esc to return to the deck."
  ], " ESC BACK   ↑↓ NEXT COMMAND   Q QUIT ", width, rows, item.phase);
}

export function renderPrompt(value = "", error = "", columns = 94, rows = 23): string {
  const width = Math.max(72, Math.min(columns, 100));
  return frame([
    `${color.yellow}cult >${color.white} ${value}`,
    "",
    ...(error ? [`${color.yellow}${error}${color.white}`] : ["Type a command without the cult prefix."]),
    "",
    "Examples",
    "doctor",
    "inspect 12",
    "message 12 \"Please include tests\""
  ], " ENTER RUN   ESC CANCEL   BACKSPACE EDIT ", width, rows, "COMMAND");
}

export function renderConfirmation(value: string, columns = 94, rows = 23): string {
  const width = Math.max(72, Math.min(columns, 100));
  return frame([
    `${color.yellow}CONFIRM STATE CHANGE${color.white}`,
    "",
    `cult ${value}`,
    "",
    "This command can change GitHub or ACP state.",
    "Review the command before continuing."
  ], " Y CONFIRM   N CANCEL   ESC COMMAND MODE ", width, rows, "CONFIRM");
}

export function renderResult(value: string, exitCode: number, columns = 94, rows = 23): string {
  const width = Math.max(72, Math.min(columns, 100));
  return frame([
    ...(exitCode === 0 ? [] : [`${color.yellow}FAILED · EXIT ${exitCode}${color.white}`, ""]),
    ...wrap(value || "Command completed without output.", width - 4)
  ], " ESC DECK   / NEW COMMAND   Q QUIT ", width, rows, "RESULT");
}

export function runBbs(): void {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("cult ui requires an interactive terminal");
  }

  let selected = 0;
  let mode: "deck" | "detail" | "prompt" | "confirm" | "result" = "deck";
  let commandLine = "";
  let promptError = "";
  let result = "";
  let exitCode = 0;

  const render = (): void => {
    const columns = Math.max(60, (process.stdout.columns ?? 95) - 1);
    const rows = Math.max(12, (process.stdout.rows ?? 24) - 1);
    const screen = mode === "detail"
      ? renderCommand(selected, columns, rows)
      : mode === "prompt"
        ? renderPrompt(commandLine, promptError, columns, rows)
        : mode === "confirm"
          ? renderConfirmation(commandLine, columns, rows)
          : mode === "result"
            ? renderResult(result, exitCode, columns, rows)
            : renderDeck(selected, columns, rows);
    process.stdout.write(`${ESC}H${ESC}2J${screen}`);
  };

  const execute = (): void => {
    const args = parseCommandLine(commandLine);
    const execution = spawnSync(process.execPath, [process.argv[1]!, ...args], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: process.env,
      maxBuffer: 10 * 1024 * 1024
    });
    exitCode = execution.status ?? 1;
    result = [execution.stdout, execution.stderr].filter(Boolean).join("\n").trim();
    mode = "result";
  };

  const submit = (): void => {
    try {
      const args = parseCommandLine(commandLine);
      promptError = validateCommand(args) ?? "";
      if (promptError) return;
      mode = mutatingCommands.has(args[0]!) ? "confirm" : "prompt";
      if (mode === "prompt") execute();
    } catch (error) {
      promptError = error instanceof Error ? error.message : String(error);
    }
  };

  const quit = (): void => {
    process.stdout.off("resize", render);
    process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdout.write(`${color.reset}${ESC}?25h${ESC}?1049l`);
  };

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdout.on("resize", render);
  process.stdin.on("data", (input: Buffer) => {
    const value = input.toString();
    if (value.length > 1 && value !== "\u001b[A" && value !== "\u001b[B") {
      for (const character of value) {
        process.stdin.emit("data", Buffer.from(character));
      }
      return;
    }
    const key = value;
    if (key === "\u0003" || (key === "q" && mode !== "prompt")) {
      quit();
      return;
    }

    if (mode === "prompt") {
      if (key === "\u001b") {
        mode = "deck";
      } else if (key === "\r") {
        submit();
      } else if (key === "\u007f") {
        commandLine = commandLine.slice(0, -1);
        promptError = "";
      } else if (/^[\x20-\x7e]+$/.test(key)) {
        commandLine += key;
        promptError = "";
      }
      render();
      return;
    }

    if (mode === "confirm") {
      if (key.toLowerCase() === "y") execute();
      if (key.toLowerCase() === "n") mode = "deck";
      if (key === "\u001b") mode = "prompt";
      render();
      return;
    }

    if (key === "/") {
      commandLine = "";
      promptError = "";
      mode = "prompt";
    } else if (mode === "result" && key === "\u001b") {
      mode = "deck";
    } else if (key === "\r") {
      mode = "detail";
    } else if (key === "\u001b") {
      mode = "deck";
    } else if (key === "\u001b[A" || key === "k") {
      selected = Math.max(0, selected - 1);
    } else if (key === "\u001b[B" || key === "j") {
      selected = Math.min(commands.length - 1, selected + 1);
    } else if (mode === "deck" && /^[1-9]$/.test(key)) {
      selected = Number(key) - 1;
    }
    render();
  });

  process.stdout.write(`${ESC}?1049h${ESC}?25l`);
  render();
}
