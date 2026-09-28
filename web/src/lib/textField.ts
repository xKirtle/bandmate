/**
 * Whether typing there is text, e.g. an input or text box, rather than a
 * checkbox or slider. A read-only one, e.g. a text box in Sync mode, isn't
 * typed in.
 */
export function inTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement) return !target.readOnly;
  const notText = ['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'file'];
  return target instanceof HTMLInputElement && !target.readOnly && !notText.includes(target.type);
}
