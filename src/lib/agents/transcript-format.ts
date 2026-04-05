const OSC_SEQUENCE = /\u001B\][\s\S]*?(?:\u0007|\u001B\\)/g;
const DCS_SEQUENCE = /\u001B[P^_X][\s\S]*?\u001B\\/g;
const CSI_SEQUENCE = /\u001B\[[0-?]*[ -/]*[@-~]/g;
const ESCAPE_SEQUENCE = /\u001B[ -/]*[0-~]/g;
const C0_CONTROL_SEQUENCE = /[\u0000-\u0008\u000B\u000C\u000E-\u001A\u001C-\u001F\u007F]/g;
const EXPOSED_ESCAPE_FRAGMENT = /(?:^|\s)\[(?:\?(?:\d{1,4}(?:;\d{0,4})*)|\d{1,4}(?:;\d{0,4})*)[ -/]*[@-~](?=\s|$)/g;
const TMUX_STATUS_LINE = /^\[yantra-[^\n]*$/;
const BORDER_ONLY_LINE = /^[\s═─╭╮╰╯│┌┐└┘├┤┬┴┼]+$/;

function stripBackspaces(value: string): string {
  let current = value;
  while (/(?:[^\n]\u0008)/.test(current)) {
    current = current.replace(/[^\n]\u0008/g, "");
  }
  return current.replace(/\u0008/g, "");
}

export function stripTerminalSequences(output: string): string {
  return output
    .replace(OSC_SEQUENCE, "")
    .replace(DCS_SEQUENCE, "")
    .replace(CSI_SEQUENCE, "")
    .replace(ESCAPE_SEQUENCE, "")
    .replace(C0_CONTROL_SEQUENCE, "");
}

export function sanitizeTranscriptForDisplay(output: string): string {
  const withoutControls = stripBackspaces(stripTerminalSequences(output));

  const normalized = withoutControls
    .replace(/\r\n?/g, "\n")
    .replace(EXPOSED_ESCAPE_FRAGMENT, "")
    .replace(/[\t ]+\n/g, "\n");

  return normalized
    .split("\n")
    .map((line) => line.replace(/[\t ]+$/g, ""))
    .filter((line) => !TMUX_STATUS_LINE.test(line))
    .filter((line) => !BORDER_ONLY_LINE.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function sanitizeTranscriptInline(output: string): string {
  return sanitizeTranscriptForDisplay(output).replace(/\s+/g, " ").trim();
}

export function replacePastedTextNotice(
  output: string,
  displayPrompt?: string
): string {
  const cleaned = sanitizeTranscriptForDisplay(output);
  if (!displayPrompt) return cleaned;
  return cleaned.replace(/\[Pasted text #\d+(?: \+\d+ lines)?\]/g, displayPrompt);
}
