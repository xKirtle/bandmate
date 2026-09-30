// Closing a modal dialog on a click outside it, on its backdrop, while
// closing it would lose nothing.
import type { Point } from './press';

/** A dialog's box on the page. */
export type Box = Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'>;

/** Whether a point lies outside a dialog's box, on its backdrop. */
export function outsideBox(box: Box, point: Point): boolean {
  return point.clientX < box.left || point.clientX > box.right || point.clientY < box.top || point.clientY > box.bottom;
}

/**
 * One press on a dialog: a click closes it only when the press both started
 * and ended outside it, so a drag from inside (e.g. selecting text in a
 * field) never does.
 */
export class BackdropPress {
  #downOutside = false;

  /** Hears a press start, and whether it's outside the dialog. */
  down(outside: boolean) {
    this.#downOutside = outside;
  }

  /** Hears the click ending a press, and says whether it closes the dialog. */
  click(outside: boolean): boolean {
    const closes = this.#downOutside && outside;
    this.#downOutside = false;
    return closes;
  }
}

/**
 * Closes a modal dialog on a click on its backdrop, as Esc does, while
 * `canClose` says nothing would be lost; otherwise the click does nothing.
 * An attachment: `{@attach closeOnBackdrop(() => ...)}`.
 */
export function closeOnBackdrop(canClose: () => boolean) {
  return (dialog: HTMLDialogElement) => {
    const press = new BackdropPress();
    // A press on the backdrop targets the dialog itself, outside its box.
    const outside = (event: MouseEvent) => event.target === dialog && outsideBox(dialog.getBoundingClientRect(), event);
    const onDown = (event: PointerEvent) => press.down(outside(event));
    const onClick = (event: MouseEvent) => {
      if (press.click(outside(event)) && canClose()) dialog.close();
    };
    dialog.addEventListener('pointerdown', onDown);
    dialog.addEventListener('click', onClick);
    return () => {
      dialog.removeEventListener('pointerdown', onDown);
      dialog.removeEventListener('click', onClick);
    };
  };
}
