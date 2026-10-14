import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, type APIRequestContext, type APIResponse } from '@playwright/test';

// What a test needs in Bandmate before it starts, made through the HTTP API,
// as the app itself would, and read back from it afterwards.

/** The demo Backup the screenshots are taken from: a hero Song with a full Timeline, and six more. */
const demoBackup = resolve(import.meta.dirname, '../docs/screenshots/demo.bandmate');

export type Status = 'idea' | 'drafting' | 'finished' | 'shelved';

/** A Song as the Song list has it. */
export interface SongSummary {
  id: number;
  title: string;
  status: Status;
  folderId: number | null;
  tags: string[];
}

/** A Song as GET /api/songs/{id} has it; tests read what else they need from it themselves. */
export interface Song {
  id: number;
  version: number;
  title: string;
  status: Status;
  [field: string]: unknown;
}

/** A Section of the Lyric Sheet or the Scrapbook, as a Song has it. */
export interface Section {
  id: number;
  label: string;
  alternates: { id: number; active: boolean; lines: { id: number; text: string }[] }[];
}

/** A Song's Lyric Sheet and Scrapbook, as GET /api/songs/{id} has them. */
export interface Sheet {
  arrangement: number[];
  scrapbook: number[];
  sections: Section[];
}

export interface Folder {
  id: number;
  name: string;
  songs: number;
}

export interface Beat {
  id: number;
  title: string;
  [field: string]: unknown;
}

/** A Clip on a Track, as the server has it; tests read what else they need from it themselves. */
export interface Clip {
  id: number;
  name: string | null;
  /** The Beat it plays, or null for a Clip of Takes or a Sound. */
  beatId: number | null;
  start: number;
  offset: number;
  length: number;
  [field: string]: unknown;
}

/** A Song's Timeline as GET /api/songs/{id}/timeline has it: its Tracks, top to bottom, and their Clips. */
export interface Timeline {
  songId: number;
  version: number;
  tracks: { id: number; name: string; clips: Clip[]; [field: string]: unknown }[];
  /** Its Loop, if one is set. */
  loop?: Loop | null;
  [field: string]: unknown;
}

/** A Timeline's Loop, in seconds, and whether it's on. */
export interface Loop {
  start: number;
  end: number;
  on: boolean;
}

/** What a new Song is made with; whatever is left out stays as New Song makes it. */
export interface NewSong {
  title?: string;
  status?: Status;
  folder?: Folder;
  tags?: string[];
  /** The Languages its Lines are sung in, in order. */
  languages?: string[];
}

/** The worker's Bandmate, through its HTTP API: what's in it, and making more. */
export class Bandmate {
  constructor(private readonly api: APIRequestContext) {}

  /** Makes a Song, as New Song does, then gives it what's asked for. */
  async song({ title, status, folder, tags, languages }: NewSong = {}): Promise<Song> {
    let song = await json<Song>(this.api.post('/api/songs', { data: { folderId: folder?.id ?? null } }));
    if (title !== undefined || status !== undefined || languages !== undefined) {
      song = await json<Song>(this.api.patch(`/api/songs/${song.id}`, { data: { title, status, languages } }));
    }
    if (tags) await json(this.api.put(`/api/songs/${song.id}/tags`, { data: { tags } }));
    return song;
  }

  /**
   * Adds a Master to a Song, named, as Add Master does. Its file isn't real
   * audio, which the server never decodes, so it doesn't play.
   */
  master(songId: number, name: string): Promise<Song> {
    return json<Song>(
      this.api.post(`/api/songs/${songId}/masters`, {
        multipart: {
          details: JSON.stringify({ name, duration: 2.5, peaks: [0.1, 0.5, 1, 0.25] }),
          file: { name: `${name}.mp3`, mimeType: 'audio/mpeg', buffer: Buffer.from(`ID3 not really an mp3: ${name}`) },
        },
      }),
    );
  }

  /** Renames a Song, as another tab would. */
  retitle(id: number, title: string): Promise<Song> {
    return json<Song>(this.api.patch(`/api/songs/${id}`, { data: { title } }));
  }

  /** Adds a Section to the end of a Song's Lyric Sheet, or of its Scrapbook, as Add Section does. */
  addSection(songId: number, label: string, to: 'arrangement' | 'scrapbook' = 'arrangement'): Promise<Sheet> {
    const path = to === 'arrangement' ? 'sections' : 'scrapbook';
    return json<Sheet>(this.api.post(`/api/songs/${songId}/${path}`, { data: { label } }));
  }

  /** Sets an Alternate's Lines, one per line of text, as typing them does. */
  setLines(songId: number, alternateId: number, text: string): Promise<Sheet> {
    return json<Sheet>(this.api.put(`/api/songs/${songId}/alternates/${alternateId}/text`, { data: { text } }));
  }

  /** Deletes a Scrapbook Section, as its Delete does. */
  deleteSection(songId: number, sectionId: number): Promise<Sheet> {
    return json<Sheet>(this.api.delete(`/api/songs/${songId}/sections/${sectionId}`));
  }

  /** Makes an empty Folder. */
  folder(name: string): Promise<Folder> {
    return json<Folder>(this.api.post('/api/folders', { data: { name } }));
  }

  /** A Song, as it is now. */
  getSong(id: number): Promise<Song> {
    return json<Song>(this.api.get(`/api/songs/${id}`));
  }

  /** A Song's Snapshots, newest first: why each was taken. */
  snapshots(songId: number): Promise<{ id: number; reason: string }[]> {
    return json<{ id: number; reason: string }[]>(this.api.get(`/api/songs/${songId}/snapshots`));
  }

  /** A Song's Timeline, as it is now. */
  timeline(songId: number): Promise<Timeline> {
    return json<Timeline>(this.api.get(`/api/songs/${songId}/timeline`));
  }

  /** Sets a Song's Loop, on or off, as dragging along the top of the ruler does. */
  setLoop(songId: number, loop: Loop): Promise<Timeline> {
    return json<Timeline>(this.api.put(`/api/songs/${songId}/timeline/loop`, { data: loop }));
  }

  /** Every Song, wherever it's filed. */
  songs(): Promise<SongSummary[]> {
    return json<SongSummary[]>(this.api.get('/api/songs'));
  }

  folders(): Promise<Folder[]> {
    return json<Folder[]>(this.api.get('/api/folders'));
  }

  beats(): Promise<Beat[]> {
    return json<Beat[]>(this.api.get('/api/beats'));
  }

  /**
   * Restores everything in the demo Backup, as Settings' Backups does, and
   * answers with its Songs. Its hero Song, "Lorem Ipsum", has a Beat and two
   * Takes on its Timeline.
   */
  async restoreDemo(): Promise<SongSummary[]> {
    const backup = await json<{ id: number }>(this.api.post('/api/backups/upload', { data: readFileSync(demoBackup) }));
    const songs = await json<{ id: number }[]>(this.api.get(`/api/backups/${backup.id}/songs`));
    const beats = await json<{ id: number }[]>(this.api.get(`/api/backups/${backup.id}/beats`));
    await json(
      this.api.post(`/api/backups/${backup.id}/restore`, {
        data: { songs: songs.map((s) => s.id), beats: beats.map((b) => b.id) },
      }),
    );
    return this.songs();
  }

  /**
   * Empties Bandmate: every Song (and with them their Tags), Folder, Beat and
   * Backup, with the Backup schedule as on a new install. Each test starts
   * with it, as the worker's server is shared.
   */
  async wipe(): Promise<void> {
    await ok(this.api.put('/api/backups/schedule', { data: { on: false, period: 'weekly', keep: 4 } }));
    for (const folder of await this.folders()) {
      await ok(this.api.delete(`/api/folders/${folder.id}?songs=delete`));
    }
    for (const song of await this.songs()) await ok(this.api.delete(`/api/songs/${song.id}`));
    for (const beat of await this.beats()) await ok(this.api.delete(`/api/beats/${beat.id}`));
    for (const backup of await json<{ id: number }[]>(this.api.get('/api/backups'))) {
      await ok(this.api.delete(`/api/backups/${backup.id}`));
    }
  }
}

/** Fails the test, saying what the server answered, unless the request succeeded. */
async function ok(sent: Promise<APIResponse>): Promise<APIResponse> {
  const res = await sent;
  expect(res.ok(), `${res.url()} answered ${res.status()}: ${await res.text()}`).toBe(true);
  return res;
}

/** The JSON a request answered with, failing the test unless it succeeded. */
async function json<T = unknown>(sent: Promise<APIResponse>): Promise<T> {
  const res = await ok(sent);
  return res.status() === 204 ? (null as T) : ((await res.json()) as T);
}
