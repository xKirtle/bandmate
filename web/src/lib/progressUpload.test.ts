import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendWithProgress, type UploadProgress } from './progressUpload';

/** The browser's XMLHttpRequest, as far as an upload uses it, driven by the test. */
class FakeXhr {
  static last: FakeXhr;
  method = '';
  url = '';
  body: unknown;
  status = 0;
  responseText = '';
  aborted = false;
  readonly upload = new EventTarget();
  private readonly events = new EventTarget();

  constructor() {
    FakeXhr.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  send(body: unknown) {
    this.body = body;
  }
  abort() {
    this.aborted = true;
    this.events.dispatchEvent(new Event('abort'));
  }
  addEventListener(type: string, listener: EventListener) {
    this.events.addEventListener(type, listener);
  }
  getAllResponseHeaders() {
    return 'content-type: application/json\r\n';
  }

  /** The browser has sent this much of the body. */
  sent(loaded: number, total: number) {
    this.upload.dispatchEvent(Object.assign(new Event('progress'), { loaded, total, lengthComputable: true }));
  }
  /** The whole body has gone. */
  allSent() {
    this.upload.dispatchEvent(new Event('load'));
  }
  /** The server answered. */
  answer(status: number, body: string) {
    this.status = status;
    this.responseText = body;
    this.events.dispatchEvent(new Event('load'));
  }
  /** The connection failed. */
  fail() {
    this.events.dispatchEvent(new Event('error'));
  }
}

describe('sendWithProgress', () => {
  beforeEach(() => vi.stubGlobal('XMLHttpRequest', FakeXhr));
  afterEach(() => vi.unstubAllGlobals());

  it('sends the body to the address', () => {
    const file = new Blob(['backup']);
    sendWithProgress('POST', '/api/backups/upload', file);
    expect(FakeXhr.last.method).toBe('POST');
    expect(FakeXhr.last.url).toBe('/api/backups/upload');
    expect(FakeXhr.last.body).toBe(file);
  });

  it('says how much of the body has been sent, then that the server is checking it', () => {
    const seen: UploadProgress[] = [];
    sendWithProgress('POST', '/up', new Blob(['x']), { onProgress: (p) => seen.push(p) });
    FakeXhr.last.sent(0, 200);
    FakeXhr.last.sent(84, 200);
    FakeXhr.last.sent(200, 200);
    FakeXhr.last.allSent();
    expect(seen).toEqual([
      { step: 'sending', sent: 0 },
      { step: 'sending', sent: 0.42 },
      { step: 'sending', sent: 1 },
      { step: 'checking' },
    ]);
  });

  it('answers with the server’s response', async () => {
    const sending = sendWithProgress('POST', '/up', new Blob(['x']));
    FakeXhr.last.answer(201, '{"id":7}');
    const res = await sending;
    expect(res.status).toBe(201);
    expect(res.ok).toBe(true);
    expect(await res.json()).toEqual({ id: 7 });
  });

  it('answers with a refusal as it is, for the caller to read', async () => {
    const sending = sendWithProgress('POST', '/up', new Blob(['x']));
    FakeXhr.last.answer(400, '{"error":"Not a Backup"}');
    const res = await sending;
    expect(res.ok).toBe(false);
    expect(await res.json()).toEqual({ error: 'Not a Backup' });
  });

  it('answers a 204 with no body', async () => {
    const sending = sendWithProgress('POST', '/up', new Blob(['x']));
    FakeXhr.last.answer(204, '');
    expect((await sending).status).toBe(204);
  });

  it('fails as fetch does when the server can’t be reached', async () => {
    const sending = sendWithProgress('POST', '/up', new Blob(['x']));
    FakeXhr.last.fail();
    await expect(sending).rejects.toBeInstanceOf(TypeError);
  });

  it('stops the upload when aborted, failing with an AbortError', async () => {
    const controller = new AbortController();
    const sending = sendWithProgress('POST', '/up', new Blob(['x']), { signal: controller.signal });
    controller.abort();
    expect(FakeXhr.last.aborted).toBe(true);
    await expect(sending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('doesn’t start an upload already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const before = FakeXhr.last;
    await expect(sendWithProgress('POST', '/up', new Blob(['x']), { signal: controller.signal })).rejects.toMatchObject(
      { name: 'AbortError' },
    );
    expect(FakeXhr.last).toBe(before);
  });
});
