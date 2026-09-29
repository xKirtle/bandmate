// Prepares a picture to become a Song's Cover. The browser does all the
// image work, and the server keeps what it makes as sent: the original,
// normalized so any browser can open it again, and the crop square in the
// sizes the Song list and header show.
import { centredSquare, fitWithin, type Size, type Square } from './cover';
import { formatSize } from './upload';

/** The most pixels on each side of a Cover's original. */
const originalSide = 2048;

/** The crop square's sizes, in pixels: 44px in the list and 128px in the header, at 3×. */
export const coverSides = { list: 132, header: 384 } as const;

/** Thrown when the browser can't open a picture. */
export class UnopenablePictureError extends Error {
  constructor() {
    super("This picture can't be opened in this browser");
  }
}

/** The pictures of a Cover, ready to upload. */
export interface PreparedCover {
  original: Blob;
  list: Blob;
  header: Blob;
  /** The original's size, in pixels. */
  width: number;
  height: number;
  /** The square of the original the Cover shows, in its pixels. */
  crop: Square;
}

/**
 * Checks a picture is small enough and makes its Cover, cropped to its
 * largest centred square. Fails with a message to show if it can't.
 */
export async function prepareCover(file: File, maxBytes: number): Promise<PreparedCover> {
  if (file.size > maxBytes) {
    throw new Error(`“${file.name}” is ${formatSize(file.size)}, over the Cover limit of ${formatSize(maxBytes)}.`);
  }
  const picture = await open(file);
  try {
    const type = await pictureType();
    const size = fitWithin(picture.width, picture.height, originalSide);
    const original = canvas(size, type);
    original.getContext('2d')!.drawImage(picture.source, 0, 0, size.width, size.height);
    const crop = centredSquare(size.width, size.height);
    const square = (side: number) => {
      const c = canvas({ width: side, height: side }, type);
      c.getContext('2d')!.drawImage(original, crop.x, crop.y, crop.size, crop.size, 0, 0, side, side);
      return encode(c, type);
    };
    const [originalBlob, list, header] = await Promise.all([
      encode(original, type),
      square(coverSides.list),
      square(coverSides.header),
    ]);
    return { original: originalBlob, list, header, ...size, crop };
  } finally {
    picture.close();
  }
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
    throw new UnopenablePictureError();
  }
  if (!(img.naturalWidth > 0 && img.naturalHeight > 0)) {
    URL.revokeObjectURL(url);
    throw new UnopenablePictureError();
  }
  return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
}

type PictureType = 'image/webp' | 'image/jpeg';

let supported: Promise<PictureType> | undefined;

/** WebP, or JPEG where the browser can't encode WebP: it then makes a PNG instead. */
function pictureType(): Promise<PictureType> {
  supported ??= new Promise((resolve) =>
    canvas({ width: 1, height: 1 }, 'image/jpeg').toBlob(
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
