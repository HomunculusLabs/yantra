export function replacePastedTextNotice(
  output: string,
  displayPrompt?: string
): string {
  if (!displayPrompt) return output;
  return output.replace(/\[Pasted text #\d+(?: \+\d+ lines)?\]/g, displayPrompt);
}
