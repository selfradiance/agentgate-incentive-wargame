const CONTROL_CHARS_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

export function sanitizePromptText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(CONTROL_CHARS_RE, ' ');
}

export function serializePromptValue(value: unknown): string {
  const json = JSON.stringify(value, null, 2);
  return sanitizePromptText(json ?? 'null');
}
