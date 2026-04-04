export function decodeDataviewAttribute(value: string | null): string {
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function encodeDataviewAttribute(value: string): string {
  return encodeURIComponent(value);
}
