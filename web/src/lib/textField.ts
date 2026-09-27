/** Whether typing there is text, e.g. an input or text box, rather than a checkbox or slider. */
export function inTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement) return true;
  const notText = ['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'file'];
  return target instanceof HTMLInputElement && !notText.includes(target.type);
}
