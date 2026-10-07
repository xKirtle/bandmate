import { expect, type APIRequestContext, type Page, type Request } from '@playwright/test';
import type { Beat } from './bandmate';

// What adding a Beat needs that the harness doesn't have: an audio file to
// add, a Beat already in the Library, and a link's fetch stubbed in the
// browser, as yt-dlp and the network are out of the suite's reach.

/** An audio file, as a file input takes one. */
export interface AudioFile {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

/**
 * A WAV of a quiet tone, `seconds` long, which the browser decodes like any
 * Beat. Its name is what the app suggests details from, e.g.
 * "dark_trap_140bpm_Am.wav" suggests "Dark Trap" at 140 BPM in Am.
 */
export function toneWav(name: string, seconds = 2): AudioFile {
  const rate = 8000;
  const samples = Math.round(rate * seconds);
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    buffer.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / rate)), 44 + i * 2);
  }
  return { name, mimeType: 'audio/wav', buffer };
}

/** A Beat's details, as the app sends them. */
export interface BeatDetails {
  title: string;
  producer?: string;
  sourceLink?: string;
  bpm?: number | null;
  key?: string;
  notes?: string;
}

/** Uploads a file as a Beat through the HTTP API, as Add Beat does, and answers with it. */
export async function uploadBeat(api: APIRequestContext, file: AudioFile, details: BeatDetails): Promise<Beat> {
  const seconds = (file.buffer.length - 44) / 2 / 8000;
  const res = await api.post('/api/beats', {
    multipart: {
      details: JSON.stringify({
        producer: '',
        sourceLink: '',
        bpm: null,
        key: '',
        notes: '',
        ...details,
        duration: seconds,
        peaks: Array.from({ length: Math.ceil(seconds * 100) }, () => 0.25),
      }),
      file,
    },
  });
  expect(res.ok(), `adding a Beat answered ${res.status()}: ${await res.text()}`).toBe(true);
  return (await res.json()) as Beat;
}

/** The Clips on each of a Song's Tracks, by Track name: the Beat each plays, by id. */
export async function beatsOnTracks(api: APIRequestContext, songId: number): Promise<Record<string, number[]>> {
  const res = await api.get(`/api/songs/${songId}/timeline`);
  expect(res.ok()).toBe(true);
  const timeline = (await res.json()) as { tracks: { name: string; clips: { beatId: number | null }[] }[] };
  return Object.fromEntries(timeline.tracks.map((t) => [t.name, t.clips.map((c) => c.beatId ?? 0)]));
}

/** What a link's fetch, as fetchLink answers it, says of the video. */
export interface FetchedVideo {
  title: string;
  producer: string;
  sourceLink: string;
  file: AudioFile;
}

/** What the app asked of the stubbed fetches, so far. */
export interface StubbedFetches {
  /** The links sent to be fetched. */
  readonly links: string[];
  /** The fetched files' ids, as the app discarded them. */
  readonly discarded: string[];
  /** The details each fetched file was added with, by its id. */
  readonly added: { id: string; details: Record<string, unknown> }[];
}

/**
 * Stubs a link's fetch in the browser, so adding from a link works without
 * yt-dlp or the network: the fetch answers with `video`, its audio is
 * `video.file`, a discard is noted, and adding it uploads the file as a Beat
 * with the details sent, as the server would have kept the fetched file.
 * Each fetch gets an id of its own, "stub-1", "stub-2", and so on.
 */
export async function stubLinkFetches(page: Page, video: FetchedVideo): Promise<StubbedFetches> {
  const stubbed = { links: [] as string[], discarded: [] as string[], added: [] as StubbedFetches['added'] };
  const fetchedId = (request: Request) => new URL(request.url()).pathname.split('/')[3];

  await page.route('**/api/fetches', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    stubbed.links.push((route.request().postDataJSON() as { link: string }).link);
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        id: `stub-${stubbed.links.length}`,
        title: video.title,
        producer: video.producer,
        sourceLink: video.sourceLink,
        fileName: video.file.name,
        contentType: video.file.mimeType,
        size: video.file.buffer.length,
      }),
    });
  });
  await page.route('**/api/fetches/*/audio', (route) =>
    route.fulfill({ status: 200, contentType: video.file.mimeType, body: video.file.buffer }),
  );
  await page.route('**/api/fetches/*', async (route) => {
    if (route.request().method() !== 'DELETE') return route.fallback();
    stubbed.discarded.push(fetchedId(route.request()));
    await route.fulfill({ status: 204 });
  });
  await page.route('**/api/fetches/*/beat', async (route) => {
    const details = route.request().postDataJSON() as Record<string, unknown> & BeatDetails;
    stubbed.added.push({ id: fetchedId(route.request()), details });
    const beat = await uploadBeat(page.request, video.file, details);
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(beat) });
  });
  return stubbed;
}
