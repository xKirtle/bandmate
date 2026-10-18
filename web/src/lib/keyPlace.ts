import { inTextField } from './textField';

// Where every key is for what's in it: a dialog, a popover (e.g. the Cues
// menu, Reading options or the Chord popover), a ⋯ menu, or a list, e.g. a
// picker's or a combobox's.
const keyOwners = 'dialog, [role="dialog"], [role="menu"], [role="listbox"]';

// Controls whose arrows move within them: a slider, a number box, a
// combobox, a tab list, radio buttons, a ⋯ or a field that opens its menu
// or list with them.
const arrowControls =
  '[role="slider"], [role="spinbutton"], [role="combobox"], [role="tablist"], [role="radiogroup"], [aria-haspopup="true"], [aria-haspopup="menu"], [aria-haspopup="listbox"]';

const arrows = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];

/**
 * Whether a key pressed on the Song page is the control's own where it was
 * pressed, which every Shortcut then leaves to it, whatever its keys:
 *
 * - every key typed in a text field;
 * - every key pressed in a dialog, a popover, a ⋯ menu or a list. It's
 *   where the key was pressed that counts, not whether one is open: with a
 *   popover open and focus left on the page, Space still plays;
 * - Space on a select, a checkbox or a radio button, though on any other
 *   button it plays or pauses, as focus a click left there shouldn't stop it;
 * - Home and End on a select or a range slider, e.g. a Track's volume,
 *   though not on the ruler, where they go to the start and the end;
 * - an arrow in a control that moves with it, e.g. a number box, a slider
 *   or a ⋯.
 */
export function ownKey(event: { key: string; target: EventTarget | null }): boolean {
  const { key, target } = event;
  if (inTextField(target)) return true;
  if (!(target instanceof Element)) return false;
  if (target.closest(keyOwners)) return true;
  if (key === ' ') return target instanceof HTMLSelectElement || isInput(target, 'checkbox', 'radio');
  if (key === 'Home' || key === 'End') return target instanceof HTMLSelectElement || isInput(target, 'range');
  if (!arrows.includes(key)) return false;
  if (target instanceof HTMLSelectElement || isInput(target, 'range', 'number', 'radio')) return true;
  return target.closest(arrowControls) !== null;
}

/** Whether it's an input of one of these types. */
function isInput(target: Element, ...types: string[]): boolean {
  return target instanceof HTMLInputElement && types.includes(target.type);
}
