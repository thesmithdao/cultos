import { describe, expect, test } from "vitest";
import {
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
    const screen = stripAnsi(renderDeck(0, 80));

    expect(screen).toContain("TERMINAL");
    expect(screen).toContain("hire <issue> --provider");
    expect(screen).toContain("verify <issue>");
    expect(screen).toContain("settle <issue> --approve");
    expect(screen).not.toContain("…");
    for (const description of [
      "Check GitHub + ACP.",
      "Create work contract",
      "Open a provider job.",
      "Read job updates.",
      "Fund quote.",
      "Message provider.",
      "Set provider price.",
      "Submit a PR.",
      "Check commit + CI.",
      "Release payment.",
      "Reject with receipt.",
      "List repo jobs."
    ]) expect(screen).toContain(description);
  });

  test("renders a detail screen", () => {
    const screen = stripAnsi(renderCommand(8, 80));

    expect(screen).toContain("VERIFY // MAINTAINER");
    expect(screen).toContain("cult verify <issue>");
    expect(screen).toContain("Check commit + CI.");
  });

  test("renders all command screens", () => {
    for (let index = 0; index < 12; index += 1) {
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
