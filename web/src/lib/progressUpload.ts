// Sends a request body, such as a file, saying how far it has got: fetch
// can't report how much of a body is sent, so this goes through
// XMLHttpRequest. It knows nothing of what's uploaded, and answers with a
// Response, as fetch does, for the caller to read.

/**
 * How far an upload has got: sending its body, with the share of it sent
 * from 0 to 1, or, once all of it has gone, waiting while the server checks
 * it before answering.
 */
export type UploadProgress = { step: 'sending'; sent: number } | { step: 'checking' };

export interface UploadOptions {
  /** Told as the body goes out, and once it's all gone. */
  onProgress?: (progress: UploadProgress) => void;
  /** Aborting it stops the upload, which fails with an AbortError. */
  signal?: AbortSignal;
}

/**
 * Sends a body to an address, as fetch would, but reporting how much of it
 * has been sent. Fails as fetch does: with a TypeError when the server can't
 * be reached, and with an AbortError when aborted.
 */
export function sendWithProgress(
  method: string,
  url: string,
  body: XMLHttpRequestBodyInit,
  { onProgress, signal }: UploadOptions = {},
): Promise<Response> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);

    xhr.upload.addEventListener('progress', (event) => {
      const { loaded, total } = event as ProgressEvent;
      onProgress?.({ step: 'sending', sent: total > 0 ? loaded / total : 0 });
    });
    xhr.upload.addEventListener('load', () => onProgress?.({ step: 'checking' }));

    const abort = () => xhr.abort();
    signal?.addEventListener('abort', abort);
    const stopListening = () => signal?.removeEventListener('abort', abort);

    xhr.addEventListener('load', () => {
      stopListening();
      resolve(
        new Response(nullBodyStatus(xhr.status) ? null : xhr.responseText, {
          status: xhr.status,
          headers: responseHeaders(xhr.getAllResponseHeaders()),
        }),
      );
    });
    xhr.addEventListener('error', () => {
      stopListening();
      reject(new TypeError('Failed to fetch'));
    });
    xhr.addEventListener('abort', () => {
      stopListening();
      reject(abortError());
    });
    xhr.send(body);
  });
}

function abortError(): DOMException {
  return new DOMException('The upload was aborted.', 'AbortError');
}

/** A Response with one of these statuses can't have a body. */
function nullBodyStatus(status: number): boolean {
  return status === 204 || status === 205 || status === 304;
}

/** XMLHttpRequest's headers, one "name: value" a line, as Headers. */
function responseHeaders(all: string): Headers {
  const headers = new Headers();
  for (const line of all.trim().split(/[\r\n]+/)) {
    const at = line.indexOf(':');
    if (at > 0) headers.append(line.slice(0, at).trim(), line.slice(at + 1).trim());
  }
  return headers;
}
