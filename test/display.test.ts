import { describe, expect, it } from "vitest";
import { cell, plain, safe } from "../src/display.js";

const ESC = "\u001b";

describe("safe", () => {
  it("removes colour and cursor sequences", () => {
    expect(safe(`${ESC}[31mred${ESC}[0m`)).toBe("red");
    expect(safe(`clean${ESC}[2K${ESC}[A`)).toBe("clean");
  });

  it("removes operating system commands", () => {
    expect(safe(`${ESC}]0;window title\u0007text`)).toBe("text");
    expect(safe(`${ESC}]8;;https://evil.example${ESC}\\link`)).toBe("link");
  });

  it("keeps a provider from adding or rewriting lines", () => {
    expect(safe("Verified\r\nVerification failed: none")).toBe("VerifiedVerification failed: none");
    expect(safe("before\rafter")).toBe("beforeafter");
  });

  it("turns tabs into spaces so column widths stay honest", () => {
    expect(safe("a\tb")).toBe("a b");
  });

  it("removes eight-bit control characters", () => {
    expect(safe("a\u009bb")).toBe("ab");
  });

  it("leaves ordinary text untouched", () => {
    expect(safe("Fix the parser (#47) — 100% done")).toBe("Fix the parser (#47) — 100% done");
  });
});

describe("plain", () => {
  it("keeps line breaks", () => {
    expect(plain("one\ntwo")).toBe("one\ntwo");
  });

  it("drops the carriage return that would overwrite a line", () => {
    expect(plain("one\r\ntwo")).toBe("one\ntwo");
    expect(plain("kept\roverwritten")).toBe("keptoverwritten");
  });

  it("removes escape sequences", () => {
    expect(plain(`${ESC}[31mred${ESC}[0m`)).toBe("red");
  });
});

describe("cell", () => {
  it("escapes the table separator", () => {
    expect(cell("a|b")).toBe("a\\|b");
  });

  it("collapses a value that would break out of its row", () => {
    expect(cell("url |\n| Result | **completed**")).toBe("url \\|\\| Result \\| **completed**");
  });
});
