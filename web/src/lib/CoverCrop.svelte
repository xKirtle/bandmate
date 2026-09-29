<script lang="ts">
  import { onMount } from 'svelte';
  import { centredSquare, maxCoverZoom, moveSquare, wholeSquare, zoomSquare, type Point, type Square } from './cover';
  import type { CoverToCrop } from './coverUpload';

  // The crop step of adding a Cover or adjusting its crop: a square frame over the picture, which
  // is dragged under it and zoomed by pinching, scrolling or the slider.
  // Full-screen on a phone.
  let {
    picture,
    initial,
    confirmLabel,
    onConfirm,
    onCancel,
  }: {
    picture: CoverToCrop;
    /** The square it opens on; the largest one, centred, if not given. */
    initial?: Square;
    /** Names what confirming does, e.g. "Add Cover". */
    confirmLabel: string;
    /** The square chosen, in whole pixels of the original. */
    onConfirm: (crop: Square) => void;
    onCancel: () => void;
  } = $props();

  let dialog = $state<HTMLDialogElement>();
  let stage = $state<HTMLElement>();
  let stageSide = $state(0);
  // Opens on the picture and square the step opened with.
  // svelte-ignore state_referenced_locally
  let crop = $state<Square>(initial ?? centredSquare(picture.width, picture.height));
  let chosen: Square | null = null;

  // The picture is the one the step opened with.
  // svelte-ignore state_referenced_locally
  const url = URL.createObjectURL(picture.blob);
  const largest = $derived(Math.min(picture.width, picture.height));
  // The frame leaves a margin of the picture around it on every side.
  const margin = $derived(stageSide * 0.1);
  const scale = $derived((stageSide - 2 * margin) / crop.size);

  onMount(() => {
    dialog?.showModal();
    return () => URL.revokeObjectURL(url);
  });

  function move(dx: number, dy: number) {
    crop = moveSquare(crop, dx, dy, picture);
  }

  function zoom(size: number, on: Point = { x: crop.x + crop.size / 2, y: crop.y + crop.size / 2 }) {
    crop = zoomSquare(crop, size, on, picture);
  }

  /** The point of the picture under a point on the screen. */
  function pictureAt(clientX: number, clientY: number): Point {
    const rect = stage!.getBoundingClientRect();
    return { x: crop.x + (clientX - rect.left - margin) / scale, y: crop.y + (clientY - rect.top - margin) / scale };
  }

  // The pointers down on the stage: one drags, two pinch.
  const pointers = new Map<number, Point>();

  function pointerDown(event: PointerEvent) {
    if (pointers.size >= 2 || event.button !== 0) return;
    stage!.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  }

  function pointerMove(event: PointerEvent) {
    if (!pointers.has(event.pointerId)) return;
    const before = [...pointers.values()];
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const after = [...pointers.values()];
    // The picture follows the pointers' middle, and two also zoom it.
    const [from, to] = [middle(before), middle(after)];
    move((from.x - to.x) / scale, (from.y - to.y) / scale);
    if (after.length === 2) zoom((crop.size * distance(before)) / distance(after), pictureAt(to.x, to.y));
  }

  function pointerUp(event: PointerEvent) {
    pointers.delete(event.pointerId);
  }

  const middle = (points: Point[]): Point => ({
    x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
    y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
  });
  const distance = ([a, b]: Point[]) => Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));

  // Added by hand, as it must stop the page scrolling.
  function wheelZoom(node: HTMLElement) {
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const pixels = [1, 16, stageSide][event.deltaMode] ?? 1;
      zoom(crop.size * Math.exp(event.deltaY * pixels * 0.002), pictureAt(event.clientX, event.clientY));
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }

  function onKeydown(event: KeyboardEvent) {
    const step = crop.size * 0.05;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    if (event.key in moves) move(...moves[event.key]);
    else if (event.key === '+' || event.key === '=') zoom(crop.size / 1.25);
    else if (event.key === '-') zoom(crop.size * 1.25);
    else return;
    event.preventDefault();
  }

  function confirm() {
    chosen = wholeSquare(crop, picture);
    dialog?.close();
  }

  function onClose() {
    if (chosen) onConfirm(chosen);
    else onCancel();
  }
</script>

<dialog bind:this={dialog} onclose={onClose} aria-labelledby="cover-crop-heading">
  <h2 id="cover-crop-heading">Choose the Cover</h2>
  <p class="muted hint">Drag to move the picture in the square. Pinch, scroll or use the slider to zoom.</p>

  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <div
    class="stage"
    bind:this={stage}
    bind:clientWidth={stageSide}
    {@attach wheelZoom}
    onpointerdown={pointerDown}
    onpointermove={pointerMove}
    onpointerup={pointerUp}
    onpointercancel={pointerUp}
    onlostpointercapture={pointerUp}
    onkeydown={onKeydown}
    tabindex="0"
    role="application"
    aria-label="Cover square: arrow keys move it, plus and minus zoom"
  >
    <img
      src={url}
      alt=""
      draggable="false"
      style:left="{margin - crop.x * scale}px"
      style:top="{margin - crop.y * scale}px"
      style:width="{picture.width * scale}px"
      style:height="{picture.height * scale}px"
    />
    <div class="frame" style:inset="{margin}px"></div>
  </div>

  <label class="zoom">
    <span>Zoom</span>
    <input
      type="range"
      min="1"
      max={maxCoverZoom}
      step="0.01"
      value={largest / crop.size}
      oninput={(e) => zoom(largest / e.currentTarget.valueAsNumber)}
    />
  </label>

  <div class="footer">
    <button type="button" class="button primary" onclick={confirm}>{confirmLabel}</button>
    <button type="button" class="button" onclick={() => dialog?.close()}>Cancel</button>
  </div>
</dialog>

<style>
  dialog {
    width: min(28rem, calc(100vw - 2rem));
    max-height: calc(100dvh - 2rem);
    padding: 1rem;
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    background: var(--bg);
    color: var(--text);
  }
  dialog[open] {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.4);
  }
  /* A phone gives the whole screen to it, clear of the notch and home
     indicator. */
  @media (width < 40rem) {
    dialog {
      width: 100%;
      max-width: none;
      height: 100%;
      max-height: none;
      margin: 0;
      padding: max(1rem, env(safe-area-inset-top)) max(var(--gutter), env(safe-area-inset-right))
        max(1rem, env(safe-area-inset-bottom)) max(var(--gutter), env(safe-area-inset-left));
      border: none;
      border-radius: 0;
    }
  }
  h2 {
    margin: 0;
    font-size: 1.125rem;
  }
  .hint {
    margin: 0;
    font-size: 0.875rem;
  }
  /* Square, and no taller than the screen leaves room for. */
  .stage {
    position: relative;
    flex: none;
    width: min(100%, calc(100dvh - 16rem));
    aspect-ratio: 1;
    align-self: center;
    overflow: hidden;
    border-radius: 0.5rem;
    background: var(--surface-1);
    cursor: grab;
    touch-action: none;
    user-select: none;
  }
  .stage:active {
    cursor: grabbing;
  }
  .stage:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  img {
    position: absolute;
    max-width: none;
    pointer-events: none;
  }
  /* The picture outside the square is dimmed. */
  .frame {
    position: absolute;
    border: 2px solid #fff;
    box-shadow: 0 0 0 100vmax rgb(0 0 0 / 0.55);
    pointer-events: none;
  }
  .zoom {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    font-size: 0.875rem;
  }
  .zoom input {
    flex: 1;
  }
  .footer {
    display: flex;
    gap: 0.5rem;
  }
  @media (width < 40rem) {
    .footer > * {
      flex: 1;
    }
  }
</style>
