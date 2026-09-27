// The SPA's only way to talk to the server. It renders what the API returns
// and sends user intents back; domain rules live on the server.

export type Status = 'idea' | 'drafting' | 'finished';

/** The full Song aggregate. Every Lyric Sheet change returns one. */
export interface Song {
  id: number;
  title: string;
  status: Status;
  createdAt: string;
  updatedAt: string;
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
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  listSongs: () => request<SongSummary[]>('GET', '/songs'),
  getSong: (id: number) => request<Song>('GET', `/songs/${id}`),
  createSong: (title: string) => request<Song>('POST', '/songs', { title }),
};
