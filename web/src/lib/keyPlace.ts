import { inTextField } from './textField';

/** Where a key was pressed, and whether a dialog had the page then. */
export type KeyPlace = {
  /** A dialog is open, e.g. the shortcuts dialog. */
  dialogOpen: boolean;
  /** It was pressed in a text field, which takes typed keys. */
  inTextField: boolean;
};

/** Where a key on the Song page was pressed: whether a dialog is open, and whether in a text field. */
export function keyPlace(event: Event): KeyPlace {
  return {
    dialogOpen: document.querySelector('dialog[open]') !== null,
    inTextField: inTextField(event.target),
  };
}
