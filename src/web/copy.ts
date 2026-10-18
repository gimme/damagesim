// Copying text to the clipboard, where the page may not have the Clipboard API.

/**
 * Copies text, and says whether it did: by the Clipboard API, or where there's none (it needs a secure
 * context, which a page served over plain http to another machine isn't) or it refuses, by selecting
 * the text and the browser's copy command.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Refused (a frame's permissions, a page not focused): the copy command may still work.
  }
  const focused = document.activeElement;
  const area = document.createElement("textarea");
  area.value = text;
  // Read-only, so selecting it brings up no keyboard; fixed, so it doesn't scroll the page.
  area.readOnly = true;
  area.style.position = "fixed";
  area.style.top = "0";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();
  area.setSelectionRange(0, text.length);
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  area.remove();
  if (focused instanceof HTMLElement) focused.focus({ preventScroll: true });
  return copied;
}
