// Prepares a picture to become a Song's Cover. The browser does all the
// picture work, and the server keeps what it makes as sent: the original,
// normalized so any browser can open it again, and the crop square chosen from
// it in the sizes the Song list and header show.
import type { PreparedCover } from './api';
import { fitWithin, type Size, type Square } from './cover';
import { formatSize } from './upload';

/** The most pixels on each side of a Cover's original. */
const originalSide = 2048;

/** The crop square's sizes, in pixels: 44px in the list and 128px in the header, at 3×. */
const coverSides = { list: 132, header: 384 } as const;

const unopenable = "This picture can't be opened in this browser";

/** A picture being made a Cover: its original, normalized and scaled down, ready to crop. */
export interface CoverToCrop extends Size {
  /** The original as uploaded, which the crop step shows too. */
  blob: Blob;
  canvas: HTMLCanvasElement;
  type: PictureType;
}

/**
 * Checks a picture is small enough and makes its original, ready to crop.
 * Fails with a message to show if it can't.
 */
export async function openCover(file: File, maxBytes: number): Promise<CoverToCrop> {
  if (file.size > maxBytes) {
    throw new Error(`“${file.name}” is ${formatSize(file.size)}, over the Cover limit of ${formatSize(maxBytes)}.`);
  }
  const picture = await open(file);
  try {
    const type = await pictureType();
    const size = fitWithin(picture.width, picture.height, originalSide);
    const original = canvas(size, type);
    original.getContext('2d')!.drawImage(picture.source, 0, 0, size.width, size.height);
    return { blob: await encode(original, type), canvas: original, type, ...size };
  } finally {
    picture.close();
  }
}

/** Makes a Cover of a picture's crop square, a square of its original in whole pixels. */
export async function cropCover(picture: CoverToCrop, crop: Square): Promise<PreparedCover> {
  const square = (side: number) => {
    const c = canvas({ width: side, height: side }, picture.type);
    c.getContext('2d')!.drawImage(picture.canvas, crop.x, crop.y, crop.size, crop.size, 0, 0, side, side);
    return encode(c, picture.type);
  };
  const [list, header] = await Promise.all([square(coverSides.list), square(coverSides.header)]);
  return { original: picture.blob, list, header, width: picture.width, height: picture.height, crop };
}

/** A picture opened by the browser, ready to draw. */
interface Opened {
  source: CanvasImageSource;
  width: number;
  height: number;
  close(): void;
}

/**
 * Opens a picture, turned the way its camera says. An image element opens
 * some pictures a bitmap can't, like SVGs in Chrome.
 */
async function open(file: File): Promise<Opened> {
  try {
    const bitmap = await createImageBitmap(file);
    return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
  } catch {
    // Tried below.
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {
    URL.revokeObjectURL(url);
    throw new Error(unopenable);
  }
  if (!(img.naturalWidth > 0 && img.naturalHeight > 0)) {
    URL.revokeObjectURL(url);
    throw new Error(unopenable);
  }
  return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
}

type PictureType = 'image/webp' | 'image/jpeg';

let supported: Promise<PictureType> | undefined;

/**
 * WebP, or JPEG where the browser can't encode WebP. Asked for a type it
 * can't encode, a browser makes a PNG, so the type it made tells.
 */
function pictureType(): Promise<PictureType> {
  supported ??= new Promise((resolve) =>
    document.createElement('canvas').toBlob(
      (blob) => resolve(blob?.type === 'image/webp' ? 'image/webp' : 'image/jpeg'),
      'image/webp',
    ),
  );
  return supported;
}

/** A canvas to draw a picture of the given type on, smoothing it as it's scaled down. */
function canvas(size: Size, type: PictureType): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = size.width;
  c.height = size.height;
  const context = c.getContext('2d')!;
  context.imageSmoothingQuality = 'high';
  // JPEG has no transparency, which would turn black.
  if (type === 'image/jpeg') {
    context.fillStyle = '#fff';
    context.fillRect(0, 0, size.width, size.height);
  }
  return c;
}

function encode(c: HTMLCanvasElement, type: PictureType): Promise<Blob> {
  return new Promise((resolve, reject) =>
    c.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("This picture couldn't be prepared in this browser"))),
      type,
      0.9,
    ),
  );
}
