const oscSequence = /\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g;
const csiSequence = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const tab = /\t/g;
const controlsExceptNewline = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g;
const everyControl = /[\u0000-\u001f\u007f-\u009f]/g;

function stripSequences(value: string): string {
  return value.replace(oscSequence, "").replace(csiSequence, "");
}

/**
 * Remote text that is allowed to span lines, such as an error message.
 *
 * Line breaks survive; everything else that can move the cursor does not,
 * including the carriage return that would let remote text overwrite a line
 * the CLI already printed. Tabs become spaces so the terminal UI can keep
 * measuring width by character count.
 */
export function plain(value: string): string {
  return stripSequences(value).replace(tab, " ").replace(controlsExceptNewline, "");
}

/**
 * Remote text printed on a single line.
 *
 * A maintainer reads this output immediately before approving a settlement,
 * so a provider must not be able to add or rewrite lines within it.
 */
export function safe(value: string): string {
  return stripSequences(value).replace(tab, " ").replace(everyControl, "");
}

/** Escape a value interpolated into a Markdown table cell in a receipt. */
export function cell(value: string): string {
  return safe(value).replace(/\|/g, "\\|");
}
