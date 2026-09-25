// WS-I-1 §5.8 — best-effort clipboard copy (used by later sub-plans' WhatsApp
// reminder/summary text). Never throws: the caller shows the text in a
// read-only fallback textarea when the clipboard API is unavailable.

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
