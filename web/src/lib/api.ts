// The SPA's only way to talk to the server. It renders what the API returns
// and sends user intents back; domain rules live on the server.

export type Status = 'idea' | 'drafting' | 'finished';

export const statuses: readonly Status[] = ['idea', 'drafting', 'finished'];

/** The full Song aggregate. Every Lyric Sheet change returns one. */
export interface Song {
  id: number;
  title: string;
  status: Status;
  /** How to play the Song. "" and null mean "not set". */
  key: string;
  bpm: number | null;
  capo: number | null;
  tuning: string;
  notes: string;
  /** Whether the Lyric Sheet shows Chords; off hides them without removing them. */
  showChords: boolean;
  createdAt: string;
  updatedAt: string;
  /** The Lyric Sheet: Occurrences of Sections, in order. */
  arrangement: Occurrence[];
  /** Every Section of the Song, in the Arrangement or not. */
  sections: Section[];
  /** Ids of the Sections with no Occurrence. */
  scrapbook: number[];
}

/** One appearance of a Section in the Arrangement. */
export interface Occurrence {
  id: number;
  sectionId: number;
  /** Other Occurrences show the same Section, so editing it changes them too. */
  shared: boolean;
}

export interface Section {
  id: number;
  /** Free text; "" means no Label. */
  label: string;
  /** Exactly one is active. */
  alternates: Alternate[];
}

export interface Alternate {
  id: number;
  name: string;
  active: boolean;
  lines: Line[];
}

export interface Line {
  /** Stays the same while the Line is edited. */
  id: number;
  /** The Line as written, with Chords inline ("Hel[Am]lo"). Only for editing. */
  text: string;
  /** The Line's lyrics without its Chords. */
  lyrics: string;
  /** In the order they appear. */
  chords: Chord[];
  /** The Line holds only Chords, e.g. for an intro or solo. */
  chordLine: boolean;
}

export interface Chord {
  /** Characters (Unicode code points, not UTF-16 units) into the lyrics; may equal their length. */
  offset: number;
  name: string;
}

/** Labels offered as suggestions; any text is allowed. */
export const suggestedLabels: readonly string[] = [
  'Intro',
  'Verse',
  'Pre-Chorus',
  'Chorus',
  'Post-Chorus',
  'Hook',
  'Bridge',
  'Breakdown',
  'Interlude',
  'Solo',
  'Outro',
];

/** A partial update: only the fields present change; "" or null clears one. */
export type SongChanges = Partial<
  Pick<Song, 'title' | 'status' | 'key' | 'bpm' | 'capo' | 'tuning' | 'notes' | 'showChords'>
>;

/** Narrows the Song list. */
export interface SongFilter {
  status?: Status;
  /** Matches titles containing it, ignoring case. */
  q?: string;
}

/** A Song as shown in the Song list. */
export interface SongSummary {
  id: number;
  title: string;
  status: Status;
  updatedAt: string;
}

/** A failed request, carrying the server's readable message. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "Can't reach Bandmate. Check your connection.");
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  listSongs: (filter: SongFilter = {}) => {
    const params = new URLSearchParams();
    if (filter.status) params.set('status', filter.status);
    if (filter.q?.trim()) params.set('q', filter.q.trim());
    const query = params.toString();
    return request<SongSummary[]>('GET', query ? `/songs?${query}` : '/songs');
  },
  getSong: (id: number) => request<Song>('GET', `/songs/${id}`),
  createSong: (title: string) => request<Song>('POST', '/songs', { title }),
  updateSong: (id: number, changes: SongChanges) => request<Song>('PATCH', `/songs/${id}`, changes),
  deleteSong: (id: number) => request<null>('DELETE', `/songs/${id}`),
  /** Adds a Section at position in the Arrangement, or at the end. */
  addSection: (songId: number, section: { label?: string; position?: number }) =>
    request<Song>('POST', `/songs/${songId}/sections`, section),
  /** Adds an Occurrence of an existing Section (e.g. one from the Scrapbook) at position, or at the end. */
  addOccurrence: (songId: number, sectionId: number, position?: number) =>
    request<Song>('POST', `/songs/${songId}/occurrences`, { sectionId, position }),
  /** Creates a Section in the Scrapbook, with no Occurrence. */
  addToScrapbook: (songId: number, label = '') => request<Song>('POST', `/songs/${songId}/scrapbook`, { label }),
  /** Permanently deletes a Section; only one in the Scrapbook can be. */
  deleteSection: (songId: number, sectionId: number) =>
    request<Song>('DELETE', `/songs/${songId}/sections/${sectionId}`),
  /** Takes an Occurrence out of the Arrangement; its Section is never deleted. Without Occurrences, it's in the Scrapbook. */
  removeOccurrence: (songId: number, occurrenceId: number) =>
    request<Song>('DELETE', `/songs/${songId}/occurrences/${occurrenceId}`),
  /** Gives an Occurrence of a shared Section its own copy of the Section. */
  detach: (songId: number, occurrenceId: number) =>
    request<Song>('POST', `/songs/${songId}/occurrences/${occurrenceId}/detach`),
  setSectionLabel: (songId: number, sectionId: number, label: string) =>
    request<Song>('PATCH', `/songs/${songId}/sections/${sectionId}`, { label }),
  /** Replaces an Alternate's Lines with the lines of text. */
  replaceAlternateText: (songId: number, alternateId: number, text: string) =>
    request<Song>('PUT', `/songs/${songId}/alternates/${alternateId}/text`, { text }),
  /** Puts the Arrangement in this order of Occurrence ids. */
  reorderArrangement: (songId: number, occurrences: number[]) =>
    request<Song>('PUT', `/songs/${songId}/arrangement`, { occurrences }),
};
