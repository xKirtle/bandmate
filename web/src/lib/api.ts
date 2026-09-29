// The SPA's only way to talk to the server. It renders what the API returns
// and sends user intents back; domain rules live on the server.

export type Status = 'idea' | 'drafting' | 'finished';

export const statuses: readonly Status[] = ['idea', 'drafting', 'finished'];

/** The full Song aggregate. Every Lyric Sheet change returns one. */
export interface Song {
  id: number;
  /** Changes with every change to the Song; writes send the one they were based on. */
  version: number;
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
  /** The Lyric Sheet: ids of its Sections, in order, each at most once. */
  arrangement: number[];
  /** Every Section of the Song, in the Arrangement or not. */
  sections: Section[];
  /** Ids of the Sections not in the Arrangement. */
  scrapbook: number[];
  /** Finished recordings, in the order they were added. */
  masters: Master[];
  /** The Song's picture; null when it has none. */
  cover: Cover | null;
}

/** A Song's picture, shown as a square chosen from it. */
export interface Cover {
  /** Changes whenever the Cover does, so its pictures' addresses do too. */
  id: number;
  /** The original's size, in pixels. */
  width: number;
  height: number;
  /** The square of the original the Cover shows, in its pixels. */
  crop: { x: number; y: number; size: number };
  addedAt: string;
}

/** A Cover's pictures: the original, and the crop square at the list's and the header's sizes. */
export const coverPictures = ['original', 'list', 'header'] as const;

export type CoverPicture = (typeof coverPictures)[number];

/** A Cover the browser made from a picture, ready to upload. */
export type PreparedCover = Record<CoverPicture, Blob> & Pick<Cover, 'width' | 'height' | 'crop'>;

/** The pictures made from a Cover's crop square. */
const squarePictures = ['list', 'header'] as const;

/** A new crop square of a Cover's original and the pictures the browser made from it, ready to upload. */
export type CroppedCover = Pick<PreparedCover, (typeof squarePictures)[number] | 'crop'>;

/** A finished recording of a Song made elsewhere, never on the Timeline. */
export interface Master {
  id: number;
  /** Tells a Song's Masters apart; starts as the file's name. Only shown once there are two. */
  name: string;
  /** Exactly one of a Song's Masters is its main one. */
  main: boolean;
  notes: string;
  /** The file as uploaded, which is kept unchanged. */
  fileName: string;
  contentType: string;
  /** In bytes. */
  size: number;
  /** In seconds. */
  duration: number;
  /** The waveform, 100 per second. Only when reading one Master, not in the Song. */
  peaks?: number[];
  addedAt: string;
}

/** A partial update to a Master's name or notes. */
export type MasterChanges = Partial<Pick<Master, 'name' | 'notes'>>;

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
  /**
   * When the Line is sung, in seconds to the millisecond; null for none. A Line of an inactive Alternate keeps its
   * Cue, dormant. A Section has no Cue of its own: it starts where its first Line is cued.
   */
  cue: number | null;
}

export interface Chord {
  /** Characters (Unicode code points, not UTF-16 units) into the lyrics; may equal their length. */
  offset: number;
  name: string;
}

/** One Cue's value: a Line's; null for none. */
export interface CueValue {
  lineId: number;
  cue: number | null;
}

/** The Song a write goes to, at the version it was based on. */
export type SongAt = Pick<Song, 'id' | 'version'>;

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

/** Keys offered as suggestions, for Songs and Beats; any text is allowed. */
export const commonKeys: readonly string[] = ['C', 'Cm', 'D', 'Dm', 'E', 'Em', 'F', 'F#m', 'G', 'Gm', 'A', 'Am', 'Bb', 'B', 'Bm'];

/** A partial update: only the fields present change; "" or null clears one. */
export type SongChanges = Partial<
  Pick<Song, 'title' | 'status' | 'key' | 'bpm' | 'capo' | 'tuning' | 'notes' | 'showChords'>
>;

/** Narrows the Song list. */
export interface SongFilter {
  status?: Status;
  /** Matches titles containing it, ignoring case. */
  q?: string;
  /** Only Songs with a Master (true) or without one (false). */
  hasMaster?: boolean;
}

/** A Song as shown in the Song list. */
export interface SongSummary {
  id: number;
  title: string;
  status: Status;
  /** "" and null when not set. */
  key: string;
  bpm: number | null;
  hasMaster: boolean;
  /** The Song's Cover's id; null when it has none. */
  coverId: number | null;
  updatedAt: string;
}

/** Details the user enters about a Beat. "" and null mean "not set"; only the title is required. */
export interface BeatDetails {
  title: string;
  producer: string;
  /** A web address, e.g. where the Beat was bought or downloaded. */
  sourceLink: string;
  bpm: number | null;
  key: string;
  notes: string;
}

/** An audio file in the Beat Library, with its credit. */
export interface Beat extends BeatDetails {
  id: number;
  /** The file as uploaded, which is kept unchanged. */
  fileName: string;
  contentType: string;
  /** In bytes. */
  size: number;
  /** In seconds. */
  duration: number;
  /** The waveform, 100 per second, from 0 to 1. Only when reading one Beat, not in the list. */
  peaks?: number[];
  /** Songs using the Beat. While there are any, it can't be deleted or have its file replaced. */
  songs: { id: number; title: string }[];
  createdAt: string;
  updatedAt: string;
}

/** A Song's audio space, in seconds. Every Timeline change returns it. */
export interface Timeline {
  songId: number;
  /** The Song's, which every Timeline change moves on. */
  version: number;
  updatedAt: string;
  /** Top to bottom. */
  tracks: Track[];
  /** The Beats the Clips play, each once, without their peaks. */
  beats: ClipBeat[];
  /** Null until one is set. */
  loop: TimelineLoop | null;
}

/** The stretch of the Timeline that playback repeats while it's on, in seconds; start is before end. */
export interface TimelineLoop {
  start: number;
  end: number;
  on: boolean;
}

/** A named lane on the Timeline, with its own volume, mute and solo. */
export interface Track {
  id: number;
  name: string;
  /** In dB, from silence to maxVolume (see mixer.ts). */
  volume: number;
  muted: boolean;
  /** When any Track is soloed, only the soloed ones are heard. */
  soloed: boolean;
  /** In the order they start; they never overlap. */
  clips: Clip[];
}

/** Changes to a Track's name or levels; fields left out stay as they are. */
export type TrackChanges = Partial<Pick<Track, 'name' | 'volume' | 'muted' | 'soloed'>>;

/** A stretch of a Beat, or of a set of Takes, placed on a Track, in seconds. */
export interface Clip {
  id: number;
  /** The Beat it plays, or null for a Clip of Takes. */
  beatId: number | null;
  /** A Clip of Takes' Takes, by number; none for a Clip of a Beat. */
  takes: Take[];
  /** The Take a Clip of Takes plays, or null for a Clip of a Beat. */
  activeTakeId: number | null;
  /** The highest number its Takes ever had, so none is used twice; 0 for a Clip of a Beat. */
  lastTakeNumber: number;
  /** Where the Clip starts on the Timeline. */
  start: number;
  /**
   * Where in its source it starts playing: a Beat's file, or the span its
   * Takes are laid out in, which starts this long before the Clip does.
   */
  offset: number;
  /** How long it plays. */
  length: number;
}

/** One recording made in the app: a mono 24-bit WAV at the rate it was recorded at. */
export interface Take {
  id: number;
  /** Tells a Clip's Takes apart: "Take 3". */
  number: number;
  /** The file's size in bytes. */
  size: number;
  /** In seconds. */
  duration: number;
  sampleRate: number;
  /** The delay taken off where it was captured to place it, in seconds. */
  latencyOffset: number;
  /** Where it starts in its Clip's source span, in seconds. */
  position: number;
  /** How far it's been nudged by hand from where it was recorded, in seconds, later if positive. Position includes it. */
  nudge: number;
  recordedAt: string;
  /** The waveform, 100 per second, from 0 to 1. Only when reading one Take, not in the Timeline. */
  peaks?: number[];
}

/**
 * A stretch of a Beat, or of detached Takes, to place on a Track, e.g. a
 * deleted Clip brought back, or a recording redone.
 */
export type NewClip = Pick<Clip, 'start' | 'offset' | 'length'> &
  ({ beatId: number } | { takeIds: number[]; activeTakeId: number; lastTakeNumber: number });

/** How a Take was captured, sent with its file. */
export interface Captured {
  /** The Timeline time capture began, lead-in included, in seconds. */
  captureStart: number;
  /** The delay to take off where it was captured, in seconds. */
  latencyOffset: number;
  peaks: number[];
}

/** Where a Take was recorded, sent with its file. */
export interface TakePlacement extends Captured {
  trackId: number;
  /** Where its new Clip starts: the Track's append point. */
  start: number;
}

/**
 * How a Clip of Takes is to be, e.g. to undo or redo a Retake: its Takes,
 * each where it starts in its source span and how far it's nudged, the one
 * it plays, and its placement.
 */
export type ClipTakes = Pick<Clip, 'activeTakeId' | 'start' | 'offset' | 'length'> & {
  takes: Pick<Take, 'id' | 'position' | 'nudge'>[];
};

/**
 * A Track to add: by default empty, at the bottom, at 0 dB and neither muted
 * nor soloed. Undo uses the rest to bring a deleted Track back as it was.
 */
export interface NewTrack {
  name: string;
  /** From 0 (the top) to the number of Tracks (the bottom). */
  position?: number;
  volume?: number;
  muted?: boolean;
  soloed?: boolean;
  clips?: NewClip[];
}

/** What playing a Clip needs to know about its Beat. */
export type ClipBeat = Pick<Beat, 'id' | 'title' | 'bpm' | 'fileName' | 'size' | 'duration'>;

/** What the browser worked out by decoding an audio file, sent with it. */
export interface DecodedAudio {
  /** In seconds. */
  duration: number;
  peaks: number[];
}

/** Limits the server enforces, to check before sending anything. */
export interface ServerConfig {
  /** The largest audio file accepted, in bytes. */
  maxUploadBytes: number;
  /** The largest picture accepted for a Cover, in bytes. */
  maxCoverBytes: number;
}

/** A failed request, carrying the server's readable message. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Tells apart failures of the same status, e.g. "stale". */
    readonly code = '',
  ) {
    super(message);
  }

  /** The write was based on an old version: the Song changed elsewhere, e.g. in another tab. */
  get stale(): boolean {
    return this.status === 409 && this.code === 'stale';
  }
}

async function request<T>(method: string, path: string, body?: unknown, at?: SongAt): Promise<T> {
  const headers: Record<string, string> = {};
  // The browser sets a form's Content-Type itself, with its boundary.
  const form = body instanceof FormData;
  if (body !== undefined && !form) headers['Content-Type'] = 'application/json';
  if (at) headers['If-Match'] = `"${at.version}"`;
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : form ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "Can't reach Bandmate. Check your connection.");
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`, data?.code);
  }
  return data as T;
}

/** A Cover's pictures and details, as the server takes them. */
function coverForm(cover: PreparedCover): FormData {
  const form = new FormData();
  form.append('details', JSON.stringify({ width: cover.width, height: cover.height, crop: cover.crop }));
  for (const picture of coverPictures) form.append(picture, cover[picture], picture);
  return form;
}

/** A Cover's new crop square, the Cover it was made from and the pictures made from it, as the server takes them. */
function cropForm(from: number, cover: CroppedCover): FormData {
  const form = new FormData();
  form.append('details', JSON.stringify({ cover: from, crop: cover.crop }));
  for (const picture of squarePictures) form.append(picture, cover[picture], picture);
  return form;
}

/** An audio file with its details as a JSON part, as the server expects uploads. */
function audioForm(file: File, details: object): FormData {
  const form = new FormData();
  form.append('details', JSON.stringify(details));
  form.append('file', file);
  return form;
}

export const api = {
  getConfig: () => request<ServerConfig>('GET', '/config'),
  /** The Beat Library, newest first; q matches titles and producers. */
  listBeats: (q = '') => request<Beat[]>('GET', q.trim() ? `/beats?q=${encodeURIComponent(q.trim())}` : '/beats'),
  /** One Beat, with its peaks. */
  getBeat: (id: number) => request<Beat>('GET', `/beats/${id}`),
  addBeat: (file: File, details: BeatDetails, decoded: DecodedAudio) =>
    request<Beat>('POST', '/beats', audioForm(file, { ...details, ...decoded })),
  updateBeat: (id: number, changes: Partial<BeatDetails>) => request<Beat>('PATCH', `/beats/${id}`, changes),
  /** Swaps an unused Beat's file, keeping its details. */
  replaceBeatFile: (id: number, file: File, decoded: DecodedAudio) =>
    request<Beat>('PUT', `/beats/${id}/file`, audioForm(file, decoded)),
  /** Deletes an unused Beat and its file. */
  deleteBeat: (id: number) => request<null>('DELETE', `/beats/${id}`),
  /**
   * Where a Beat's audio streams from, with seeking. The address changes when
   * the file is replaced, so players load the new one; the server also has
   * browsers check a cached file is current.
   */
  beatAudioUrl: (beat: Pick<Beat, 'id' | 'fileName' | 'size' | 'duration'>) =>
    `/api/beats/${beat.id}/audio?v=${encodeURIComponent(`${beat.fileName}-${beat.size}-${beat.duration}`)}`,

  listSongs: (filter: SongFilter = {}) => {
    const params = new URLSearchParams();
    if (filter.status) params.set('status', filter.status);
    if (filter.q?.trim()) params.set('q', filter.q.trim());
    if (filter.hasMaster !== undefined) params.set('hasMaster', String(filter.hasMaster));
    const query = params.toString();
    return request<SongSummary[]>('GET', query ? `/songs?${query}` : '/songs');
  },
  getSong: (id: number) => request<Song>('GET', `/songs/${id}`),
  createSong: (title: string) => request<Song>('POST', '/songs', { title }),
  /** Creates a new Song from pasted lyrics; a {title: …} line in the text wins over title. */
  importSong: (text: string, title = '') => request<Song>('POST', '/songs/import', { text, title }),
  updateSong: (at: SongAt, changes: SongChanges) => request<Song>('PATCH', `/songs/${at.id}`, changes, at),
  deleteSong: (at: SongAt) => request<null>('DELETE', `/songs/${at.id}`, undefined, at),
  /** Adds a Section at position in the Arrangement, or at the end. */
  addSection: (at: SongAt, section: { label?: string; position?: number }) =>
    request<Song>('POST', `/songs/${at.id}/sections`, section, at),
  /**
   * Puts a Scrapbook Section back into the Arrangement at position, or at the end. A Section already in the
   * Arrangement is refused: it appears at most once, so Duplicate it instead.
   */
  addToArrangement: (at: SongAt, sectionId: number, position?: number) =>
    request<Song>('POST', `/songs/${at.id}/arrangement`, { sectionId, position }, at),
  /**
   * Puts a Duplicate of a Section at position in the Arrangement, or at the end: an independent copy with every
   * Alternate, the same one active, but none of its Cues.
   */
  duplicateSection: (at: SongAt, sectionId: number, position?: number) =>
    request<Song>('POST', `/songs/${at.id}/sections/${sectionId}/duplicate`, { position }, at),
  /** Creates a Section in the Scrapbook, outside the Arrangement. */
  addToScrapbook: (at: SongAt, label = '') => request<Song>('POST', `/songs/${at.id}/scrapbook`, { label }, at),
  /**
   * Adds a Section, from the Scrapbook or the Lyric Sheet, to another Section
   * in the Lyric Sheet: its Alternates join that Section's, inactive, an
   * unnamed one taking its Label as its name, their Lines' Cues coming along
   * dormant, and it's gone from wherever it was. Adding one to itself is
   * refused.
   */
  addToSection: (at: SongAt, addedId: number, sectionId: number) =>
    request<Song>('POST', `/songs/${at.id}/sections/${addedId}/add-to-section`, { sectionId }, at),
  /** Permanently deletes a Section; only one in the Scrapbook can be. */
  deleteSection: (at: SongAt, sectionId: number) =>
    request<Song>('DELETE', `/songs/${at.id}/sections/${sectionId}`, undefined, at),
  /**
   * Takes a Section out of the Arrangement, from its actions or dropped on the Scrapbook, with its Cues. It goes to
   * the end of the Scrapbook, or is deleted if nothing is written in it.
   */
  removeFromArrangement: (at: SongAt, sectionId: number) =>
    request<Song>('DELETE', `/songs/${at.id}/arrangement/${sectionId}`, undefined, at),
  /** Gives a Line a Cue, in seconds; it may lie past the last Clip. */
  setLineCue: (at: SongAt, lineId: number, cue: number) =>
    request<Song>('PUT', `/songs/${at.id}/lines/${lineId}/cue`, { cue }, at),
  /** Removes a Line's Cue. */
  clearLineCue: (at: SongAt, lineId: number) =>
    request<Song>('DELETE', `/songs/${at.id}/lines/${lineId}/cue`, undefined, at),
  /** Removes the Cues of all a Section's Lines, dormant ones included. */
  clearSectionCues: (at: SongAt, sectionId: number) =>
    request<Song>('DELETE', `/songs/${at.id}/sections/${sectionId}/cues`, undefined, at),
  /** Removes every Cue in the Song. */
  clearCues: (at: SongAt) => request<Song>('DELETE', `/songs/${at.id}/cues`, undefined, at),
  /** Sets each Cue given to its value, or clears it, as they were before another Cue edit. */
  restoreCues: (at: SongAt, cues: CueValue[]) => request<Song>('PATCH', `/songs/${at.id}/cues`, { cues }, at),
  /** Moves every Cue from start up to end, in seconds, dormant ones included, by the seconds given; refused if any would go below zero. */
  shiftCues: (at: SongAt, start: number, end: number, by: number) =>
    request<Song>('POST', `/songs/${at.id}/cues/shift`, { start, end, by }, at),
  setSectionLabel: (at: SongAt, sectionId: number, label: string) =>
    request<Song>('PATCH', `/songs/${at.id}/sections/${sectionId}`, { label }, at),
  /** Replaces an Alternate's Lines with the lines of text. */
  replaceAlternateText: (at: SongAt, alternateId: number, text: string) =>
    request<Song>('PUT', `/songs/${at.id}/alternates/${alternateId}/text`, { text }, at),
  /** Creates an inactive Alternate of a Section, starting as a copy of the active one's Lines. */
  addAlternate: (at: SongAt, sectionId: number, name = '') =>
    request<Song>('POST', `/songs/${at.id}/sections/${sectionId}/alternates`, { name }, at),
  /** Names an Alternate; "" removes its name. */
  renameAlternate: (at: SongAt, alternateId: number, name: string) =>
    request<Song>('PATCH', `/songs/${at.id}/alternates/${alternateId}`, { name }, at),
  /** Makes an Alternate the only active one of its Section. */
  activateAlternate: (at: SongAt, alternateId: number) =>
    request<Song>('POST', `/songs/${at.id}/alternates/${alternateId}/activate`, undefined, at),
  /**
   * Moves an inactive Alternate out of its Section into a new Scrapbook Section
   * of its own, with its Cues.
   */
  moveAlternateToScrapbook: (at: SongAt, alternateId: number) =>
    request<Song>('POST', `/songs/${at.id}/alternates/${alternateId}/scrapbook`, undefined, at),
  /**
   * Moves an inactive Alternate out of its Section into a Section of its own
   * at position in the Arrangement, labelled as moving it to the Scrapbook
   * does, with its Cues, now live.
   */
  moveAlternateToArrangement: (at: SongAt, alternateId: number, position: number) =>
    request<Song>('POST', `/songs/${at.id}/alternates/${alternateId}/arrangement`, { position }, at),
  /** Permanently deletes an inactive Alternate. */
  deleteAlternate: (at: SongAt, alternateId: number) =>
    request<Song>('DELETE', `/songs/${at.id}/alternates/${alternateId}`, undefined, at),
  /** Attaches a finished recording; the Song's first Master is its main one. */
  addMaster: (at: SongAt, file: File, decoded: DecodedAudio) =>
    request<Song>('POST', `/songs/${at.id}/masters`, audioForm(file, decoded), at),
  /** One Master, with its peaks. */
  getMaster: (songId: number, masterId: number) => request<Master>('GET', `/songs/${songId}/masters/${masterId}`),
  updateMaster: (at: SongAt, masterId: number, changes: MasterChanges) =>
    request<Song>('PATCH', `/songs/${at.id}/masters/${masterId}`, changes, at),
  /** Makes a Master the Song's main one, in place of the one before. */
  makeMainMaster: (at: SongAt, masterId: number) =>
    request<Song>('POST', `/songs/${at.id}/masters/${masterId}/main`, undefined, at),
  /** Deletes a Master and its file; if it was main, the earliest added of the others becomes main. */
  deleteMaster: (at: SongAt, masterId: number) =>
    request<Song>('DELETE', `/songs/${at.id}/masters/${masterId}`, undefined, at),
  /** Gives a Song without a Cover the one the browser prepared. */
  addCover: (at: SongAt, cover: PreparedCover) => request<Song>('POST', `/songs/${at.id}/cover`, coverForm(cover), at),
  /** Replaces a Song's Cover with the one the browser prepared, deleting the old one's files. */
  replaceCover: (at: SongAt, cover: PreparedCover) =>
    request<Song>('PUT', `/songs/${at.id}/cover`, coverForm(cover), at),
  /**
   * Shows a new square of a Song's Cover's original; the original isn't
   * uploaded again. Refused if the Song's Cover is no longer the one with id from.
   */
  adjustCoverCrop: (at: SongAt, from: number, cover: CroppedCover) =>
    request<Song>('PUT', `/songs/${at.id}/cover/crop`, cropForm(from, cover), at),
  /** Deletes a Song's Cover and its files. */
  removeCover: (at: SongAt) => request<Song>('DELETE', `/songs/${at.id}/cover`, undefined, at),
  /** Where one of a Song's Cover's pictures is. */
  coverUrl: (songId: number, coverId: number, picture: CoverPicture) =>
    `/api/songs/${songId}/cover/${picture}?v=${coverId}`,
  /** Where a Master's audio streams from, with seeking. */
  masterAudioUrl: (songId: number, masterId: number) => `/api/songs/${songId}/masters/${masterId}/audio`,
  /** Downloads a Master's original file under its uploaded name. */
  masterDownloadUrl: (songId: number, masterId: number) =>
    `/api/songs/${songId}/masters/${masterId}/audio?download`,
  getTimeline: (songId: number) => request<Timeline>('GET', `/songs/${songId}/timeline`),
  /**
   * Places a whole Beat on the Song's beat Track (the topmost Track holding a
   * Beat, or a new one named "Beat"), after its last Clip or at 0:00.
   */
  addBeatToTimeline: (at: SongAt, beatId: number) =>
    request<Timeline>('POST', `/songs/${at.id}/timeline/beats`, { beatId }, at),
  /** Adds a Track, by default empty at the bottom of the Timeline. */
  addTrack: (at: SongAt, track: NewTrack) => request<Timeline>('POST', `/songs/${at.id}/timeline/tracks`, track, at),
  /** Renames a Track or sets its volume, mute or solo. */
  updateTrack: (at: SongAt, trackId: number, changes: TrackChanges) =>
    request<Timeline>('PATCH', `/songs/${at.id}/timeline/tracks/${trackId}`, changes, at),
  /** Puts the Tracks in this order of ids, top to bottom; their Clips go with them. */
  reorderTracks: (at: SongAt, tracks: number[]) =>
    request<Timeline>('PUT', `/songs/${at.id}/timeline/tracks`, { tracks }, at),
  /** Removes a Track and its Clips; their Beats stay in the Beat Library. Refused for the last Track. */
  deleteTrack: (at: SongAt, trackId: number) =>
    request<Timeline>('DELETE', `/songs/${at.id}/timeline/tracks/${trackId}`, undefined, at),
  /** Moves a Clip to start at a time on a Track, keeping its trim. Refused if it would overlap a Clip there. */
  moveClip: (at: SongAt, clipId: number, trackId: number, start: number) =>
    request<Timeline>('POST', `/songs/${at.id}/timeline/clips/${clipId}/move`, { trackId, start }, at),
  /**
   * Has a Clip play length seconds of its source from offset. The audio stays
   * in place on the Timeline, so trimming the start moves where the Clip starts.
   */
  trimClip: (at: SongAt, clipId: number, offset: number, length: number) =>
    request<Timeline>('POST', `/songs/${at.id}/timeline/clips/${clipId}/trim`, { offset, length }, at),
  /** Places a stretch of a Beat, or detached Takes, on a Track. Refused if it would overlap a Clip there. */
  placeClip: (at: SongAt, trackId: number, clip: NewClip) =>
    request<Timeline>('POST', `/songs/${at.id}/timeline/clips`, { trackId, ...clip }, at),
  /** Copies a Clip right after itself, or after its Track's last Clip if that's taken. */
  duplicateClip: (at: SongAt, clipId: number) =>
    request<Timeline>('POST', `/songs/${at.id}/timeline/clips/${clipId}/duplicate`, undefined, at),
  /** Removes a Clip from the Timeline; its Beat stays in the Beat Library, and its Takes are detached. */
  deleteClip: (at: SongAt, clipId: number) =>
    request<Timeline>('DELETE', `/songs/${at.id}/timeline/clips/${clipId}`, undefined, at),
  /**
   * Places a Take just recorded, a mono 24-bit WAV, in a new Clip at start.
   * Refused if it would overlap a Clip there.
   */
  recordTake: (at: SongAt, wav: Blob, placement: TakePlacement) => {
    const form = new FormData();
    form.append('details', JSON.stringify(placement));
    form.append('file', wav, 'take.wav');
    return request<Timeline>('POST', `/songs/${at.id}/timeline/takes`, form, at);
  },
  /**
   * Records a Take just recorded, a mono 24-bit WAV, into a Clip of Takes, as
   * its active Take. The Clip grows to fit it, up to the next Clip.
   */
  retake: (at: SongAt, clipId: number, wav: Blob, captured: Captured) => {
    const form = new FormData();
    form.append('details', JSON.stringify(captured));
    form.append('file', wav, 'take.wav');
    return request<Timeline>('POST', `/songs/${at.id}/timeline/clips/${clipId}/takes`, form, at);
  },
  /** Sets a Clip's Takes, active Take and placement, detaching the Takes it no longer holds. */
  setTakes: (at: SongAt, clipId: number, takes: ClipTakes) =>
    request<Timeline>('PUT', `/songs/${at.id}/timeline/clips/${clipId}/takes`, takes, at),
  /** Makes one of a Clip's Takes the one it plays. */
  chooseTake: (at: SongAt, clipId: number, takeId: number) =>
    request<Timeline>('PUT', `/songs/${at.id}/timeline/clips/${clipId}/active-take`, { takeId }, at),
  /**
   * Detaches one of a Clip's Takes. If it was active, the most recent one left
   * is; if it was the last, the Clip is deleted.
   */
  deleteTake: (at: SongAt, clipId: number, takeId: number) =>
    request<Timeline>('DELETE', `/songs/${at.id}/timeline/clips/${clipId}/takes/${takeId}`, undefined, at),
  /** Detaches all of a Clip's Takes but the active one. */
  clearInactiveTakes: (at: SongAt, clipId: number) =>
    request<Timeline>('DELETE', `/songs/${at.id}/timeline/clips/${clipId}/inactive-takes`, undefined, at),
  /**
   * Nudges one of a Clip's Takes to be nudge seconds from where it was
   * recorded, later if positive. The Clip's window stays where it is.
   */
  nudgeTake: (at: SongAt, clipId: number, takeId: number, nudge: number) =>
    request<Timeline>('PUT', `/songs/${at.id}/timeline/clips/${clipId}/takes/${takeId}/nudge`, { nudge }, at),
  /** One of a Song's Takes, with its peaks. */
  getTake: (songId: number, takeId: number) => request<Take>('GET', `/songs/${songId}/takes/${takeId}`),
  /** Where a Take's audio streams from, exactly as recorded. A Take's file never changes. */
  takeAudioUrl: (songId: number, takeId: number) => `/api/songs/${songId}/takes/${takeId}/audio`,
  /** Where a Take's file downloads from, as recorded, named after the Song and the Take. */
  takeDownloadUrl: (songId: number, takeId: number) => `/api/songs/${songId}/takes/${takeId}/audio?download`,
  /** Sets the Song's Loop, replacing any it had. */
  setLoop: (at: SongAt, loop: TimelineLoop) => request<Timeline>('PUT', `/songs/${at.id}/timeline/loop`, loop, at),
  /** Switches the Song's Loop on or off, keeping its stretch. */
  switchLoop: (at: SongAt, on: boolean) => request<Timeline>('PATCH', `/songs/${at.id}/timeline/loop`, { on }, at),
  /** Removes the Song's Loop. */
  clearLoop: (at: SongAt) => request<Timeline>('DELETE', `/songs/${at.id}/timeline/loop`, undefined, at),
  /** Puts the Arrangement in this order of Section ids. */
  reorderArrangement: (at: SongAt, sections: number[]) =>
    request<Song>('PUT', `/songs/${at.id}/arrangement`, { sections }, at),
};
