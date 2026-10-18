// How large Read mode's Chord Chart shows its diagrams, as a percentage of
// their usual size, apart from the Lyric Size. Like the Lyric Size, it's a
// way of reading the Song, not an edit; it's about how far away the device
// sits, so it's kept on this device for every Song, and is 100% until set
// here. Below 70% a diagram's starting fret stops reading.
import type { DeviceSettingStorage } from './deviceSetting.svelte';

/** The Chart Sizes, in percent, from smallest to largest. */
export const chartSizes = [70, 80, 90, 100, 115, 130, 150, 175];

/** The Chart Size the diagrams usually show at, until set on this device. */
export const usualChartSize = 100;

/** The smallest and largest Chart Sizes. */
export const smallestChartSize = chartSizes[0];
export const largestChartSize = chartSizes[chartSizes.length - 1];

/** Where the Chart Size is kept on this device. */
export const chartSizeKey = 'bandmate.chartSize';

/** How large the Chord Chart's diagrams show: 100% unless set on this device. */
export function readChartSize(storage: Storage | undefined): number {
  try {
    const size = Number(storage?.getItem(chartSizeKey));
    return chartSizes.includes(size) ? size : usualChartSize;
  } catch {
    return usualChartSize;
  }
}

/** Keeps the Chart Size on this device, forgetting it once back to 100%. */
export function storeChartSize(storage: Storage | undefined, size: number) {
  try {
    if (size === usualChartSize) storage?.removeItem(chartSizeKey);
    else storage?.setItem(chartSizeKey, String(size));
  } catch {
    // Not kept, e.g. in a private window; the size still applies until reload.
  }
}

/** The Chart Size a step larger (by 1) or smaller (by −1), held from 70% to 175%. */
export function stepChartSize(size: number, by: number): number {
  const at = chartSizes.indexOf(size) + by;
  return chartSizes[Math.max(0, Math.min(chartSizes.length - 1, at))];
}

/** The Chart Size, kept on this device the way a Device Setting is. */
export const chartSizeSetting = {
  key: chartSizeKey,
  read: readChartSize,
  store: storeChartSize,
} satisfies DeviceSettingStorage<number>;
