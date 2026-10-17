import { inTextField } from './textField';

/** Where a key was pressed, and whether a dialog had the page then. */
export type KeyPlace = {
  /** A dialog is open, e.g. the shortcuts dialog. */
  dialogOpen: boolean;
  /** It was pressed in a text field, which takes typed keys. */
  inTextField: boolean;
  /** The arrows there are the control's own, e.g. a number box's, a list's or a slider's. */
  ownsArrows: boolean;
};

/** Where a key on the Song page was pressed: whether a dialog is open, in a text field, or in a control that uses the arrows. */
export function keyPlace(event: Event): KeyPlace {
  return {
    dialogOpen: document.querySelector('dialog[open]') !== null,
    inTextField: inTextField(event.target),
    ownsArrows: ownsArrows(event.target),
  };
}

// Controls whose arrows move within them: a slider, a list, a menu, a
// tab list, radio buttons, a ⋯ or a field that opens its menu or list with them.
const arrowControls =
  '[role="slider"], [role="spinbutton"], [role="listbox"], [role="combobox"], [role="menu"], [role="tablist"], [role="radiogroup"], [aria-haspopup="true"], [aria-haspopup="menu"], [aria-haspopup="listbox"], dialog';

/**
 * Whether the arrows pressed there are the control's own: a text field's,
 * a list's, a slider's or a number box's, a menu's or a tab list's, so a
 * Shortcut given an arrow leaves it to them, as Space, Home and End are.
 */
export function ownsArrows(target: EventTarget | null): boolean {
  if (inTextField(target) || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement && ['range', 'number', 'radio'].includes(target.type)) return true;
  return target instanceof Element && target.closest(arrowControls) !== null;
}

const arrows = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];

/**
 * Whether an arrow was pressed in a control that uses it, e.g. a number
 * box, which a Shortcut given that arrow leaves alone.
 */
export function ownArrow(e: { key: string }, at: { ownsArrows: boolean }): boolean {
  return at.ownsArrows && arrows.includes(e.key);
}
