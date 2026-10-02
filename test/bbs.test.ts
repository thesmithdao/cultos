import { describe, expect, test } from "vitest";
import { width as displayWidth } from "../src/display.js";
import {
  createOutputBuffer,
  parseCommandLine,
  renderCommand,
  renderConfirmation,
  renderDeck,
  renderPrompt,
  renderRunning,
  renderResult,
  validateCommand
} from "../src/bbs.js";

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

describe("BBS command deck", () => {
  test("lists the operational commands", () => {
    const screen = [0, 16].map((selected) => stripAnsi(renderDeck(selected, 80))).join("\n");

    expect(screen).toContain("TERMINAL");
    expect(screen).toContain("help");
    expect(screen).not.toContain("agent current");
    expect(screen).toContain("hire <issue> --provider");
    expect(screen).toContain("verify <issue>");
    expect(screen).toContain("settle <issue> --approve");
    expect(screen).not.toContain("[01]");
    expect(screen).not.toContain("…");
    for (const description of [
      "List CLI commands.",
      "Check repo + ACP.",
      "Create work contract",
      "Open a provider job.",
      "Read job updates.",
      "Fund quote.",
      "Message provider.",
      "Set provider price.",
      "Submit a PR.",
      "Check delivery.",
      "Release payment.",
      "Reject with receipt.",
      "List repo jobs.",
      "Build an x402 API.",
      "Build a machine.",
      "Check x402 endpoint.",
      "First capped sale."
    ]) expect(screen).toContain(description);
  });

  test("renders a detail screen", () => {
    const screen = stripAnsi(renderCommand(13, 80));

    expect(screen).toContain("VERIFY // MAINTAINER");
    expect(screen).toContain("cult verify <issue>");
    expect(screen).toContain("Check delivery.");
  });

  test("renders all command screens", () => {
    for (let index = 0; index < 17; index += 1) {
      const lines = stripAnsi(renderCommand(index, 80)).split("\n");
      expect(lines.every((line) => line.length === 80)).toBe(true);
    }
  });

  test("fits every line to the terminal width", () => {
    const lines = stripAnsi(renderDeck(0, 80)).split("\n");

    expect(lines.every((line) => line.length === 80)).toBe(true);
  });

  test("parses quoted command input without a shell", () => {
    expect(parseCommandLine('message 12 "Please include tests"')).toEqual([
      "message",
      "12",
      "Please include tests"
    ]);
    expect(validateCommand(["message", "12", "hello"])).toBeUndefined();
    expect(validateCommand(["help"])).toBeUndefined();
    expect(validateCommand(["agent", "use", "agent-id"])).toBeUndefined();
    expect(validateCommand(["rm", "-rf"])).toBe("Unknown CultOS command: rm");
  });

  test("renders prompt, confirmation and result screens", () => {
    const screens = [
      renderDeck(0, 80),
      renderCommand(0, 80),
      renderPrompt("doctor", "", 80),
      renderConfirmation("fund 12", 80),
      renderRunning("doctor", "Checking GitHub...", 2, 80),
      renderResult("System ready.", 0, 80)
    ];
    for (const screen of screens) {
      const lines = stripAnsi(screen).split("\n");
      expect(lines.every((line) => line.length === 80)).toBe(true);
    }
    expect(new Set(screens.map((screen) => screen.split("\n").length)).size).toBe(1);
    expect(stripAnsi(renderResult("System ready.", 0, 80))).not.toContain("COMPLETE");
  });

  test("shows command progress", () => {
    const doctor = stripAnsi(renderRunning("doctor", "Checking GitHub...", 2, 80));
    const watch = stripAnsi(renderRunning("watch 12", "Waiting for an event...", 4, 80));

    expect(doctor).toContain("RUNNING · 2s");
    expect(doctor).toContain("Checking GitHub...");
    expect(watch).toContain("WATCHING · 4s");
    expect(watch).toContain("ESC CANCEL");
  });

  test("scrolls long results without changing the frame", () => {
    const output = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`).join("\n");
    const first = stripAnsi(renderResult(output, 0, 80, 18, 0));
    const next = stripAnsi(renderResult(output, 0, 80, 18, 10));

    expect(first).toContain("line 1");
    expect(first).not.toContain("line 20");
    expect(next).toContain("line 11");
    expect(first.split("\n")).toHaveLength(18);
    expect(next.split("\n")).toHaveLength(18);
  });

  test("uses the requested viewport height", () => {
    for (const rows of [18, 23, 30]) {
      expect(renderDeck(0, 80, rows).split("\n")).toHaveLength(rows);
      expect(renderResult("System ready.", 0, 80, rows).split("\n")).toHaveLength(rows);
    }
  });
});

describe("createOutputBuffer", () => {
  test("reads back everything appended", () => {
    const output = createOutputBuffer();
    output.append("one\n");
    output.append("two\n");
    output.append("three");

    expect(output.read()).toBe("one\ntwo\nthree");
  });

  test("keeps the tail once the limit is passed", () => {
    const output = createOutputBuffer(10);
    output.append("123456");
    output.append("789012");

    expect(output.read()).toBe("3456789012");
  });

  test("truncates a single chunk that alone exceeds the limit", () => {
    const output = createOutputBuffer(4);
    output.append("old");
    output.append("a much longer chunk");

    // The newest output wins: the tail is kept and the limit still holds.
    expect(output.read()).toBe("hunk");
  });

  test("set replaces the buffer", () => {
    const output = createOutputBuffer(4);
    output.append("discarded");
    output.set("not-kept");

    expect(output.read()).toBe("kept");

    output.set("");
    expect(output.read()).toBe("");
  });

  test("repeated reads without changes return the same value", () => {
    const output = createOutputBuffer();
    output.append("stable");

    expect(output.read()).toBe("stable");
    expect(output.read()).toBe("stable");
  });

  test("retains the bounded tail after many chunks", () => {
    const output = createOutputBuffer(1024);
    for (let index = 0; index < 20_000; index += 1) {
      output.append(String(index).padStart(6, "0"));
    }

    const value = output.read();
    expect(value).toHaveLength(1024);
    expect(value.endsWith("019999")).toBe(true);
  });
});

describe("frame alignment in terminal columns", () => {
  // The frame is drawn by padding each row to a fixed width. Measuring that
  // width with String.length counts UTF-16 code units, which is not what the
  // terminal draws: a CJK character occupies two columns, and an emoji cluster
  // can be four code units wide but still two columns. Either way the right
  // border drifts away from the rows above it.
  const everyRowSameWidth = (screen: string): number[] =>
    [...new Set(stripAnsi(screen).split("\n").map((line) => displayWidth(line)))];

  test("ascii output keeps a straight border", () => {
    expect(everyRowSameWidth(renderResult("plain output", 0, 80, 20))).toHaveLength(1);
  });

  test("CJK output keeps a straight border", () => {
    const screen = renderResult("残高の解析を修正しました。テストを追加。", 0, 80, 20);

    expect(everyRowSameWidth(screen)).toHaveLength(1);
  });

  test("emoji output keeps a straight border", () => {
    const screen = renderResult("done 🎉 shipped 👩‍💻 verified ✅", 0, 80, 20);

    expect(everyRowSameWidth(screen)).toHaveLength(1);
  });

  test("a long CJK line wraps without overflowing the frame", () => {
    const screen = renderResult("語".repeat(200), 0, 80, 20);

    expect(everyRowSameWidth(screen)).toHaveLength(1);
  });

  test("the running screen stays aligned too", () => {
    const screen = renderRunning("watch 42", "処理中です…", 3, 80, 20);

    expect(everyRowSameWidth(screen)).toHaveLength(1);
  });
});
