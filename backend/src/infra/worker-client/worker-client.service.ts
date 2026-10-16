import type {
  DiarizeResponse,
  HealthResponse,
  ImageEmbedResponse,
  OcrResponse,
  RequestOptions,
  ScenesResponse,
  TextEmbedResponse,
  TranscribeResponse,
  UploadInput,
  WorkerClient,
} from './interface.js';

/** Non-2xx response from the worker. `detail` is FastAPI's error detail when present. */
export class WorkerError extends Error {
  constructor(
    readonly path: string,
    readonly status: number,
    readonly detail: unknown,
  ) {
    super(
      `worker ${path} failed with ${status}: ${
        typeof detail === 'string' ? detail : JSON.stringify(detail)
      }`,
    );
    this.name = 'WorkerError';
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

/** HTTP client for the Python worker (workers/main.py). */
export class WorkerClientService implements WorkerClient {
  constructor(private readonly baseUrl: string) {}

  health(options?: RequestOptions): Promise<HealthResponse> {
    return this.request('GET', '/health', {}, undefined, options);
  }

  diarize(
    file: UploadInput,
    params: {
      numSpeakers: number | null;
      minSpeakers: number | null;
      maxSpeakers: number | null;
    },
    options?: RequestOptions,
  ): Promise<DiarizeResponse> {
    return this.request(
      'POST',
      '/diarize',
      {
        num_speakers: params.numSpeakers,
        min_speakers: params.minSpeakers,
        max_speakers: params.maxSpeakers,
      },
      toForm('file', [file]),
      options,
    );
  }

  transcribe(
    file: UploadInput,
    params: { language: string | null },
    options?: RequestOptions,
  ): Promise<TranscribeResponse> {
    return this.request(
      'POST',
      '/transcribe',
      { language: params.language },
      toForm('file', [file]),
      options,
    );
  }

  scenes(
    file: UploadInput,
    params: {
      detector: 'adaptive' | 'content';
      threshold: number | null;
      keyframes: boolean;
      keyframeWidth: number;
    },
    options?: RequestOptions,
  ): Promise<ScenesResponse> {
    return this.request(
      'POST',
      '/scenes',
      {
        detector: params.detector,
        threshold: params.threshold,
        keyframes: params.keyframes,
        keyframe_width: params.keyframeWidth,
      },
      toForm('file', [file]),
      options,
    );
  }

  embedImageQueries(
    texts: string[],
    options?: RequestOptions,
  ): Promise<TextEmbedResponse> {
    return this.request('POST', '/embed/image-query', {}, { texts }, options);
  }

  embedDocuments(
    texts: string[],
    options?: RequestOptions,
  ): Promise<TextEmbedResponse> {
    return this.request('POST', '/embed/document', {}, { texts }, options);
  }

  embedImages(
    files: UploadInput[],
    options?: RequestOptions,
  ): Promise<ImageEmbedResponse> {
    return this.request(
      'POST',
      '/embed/image',
      {},
      toForm('files', files),
      options,
    );
  }

  ocr(files: UploadInput[], options?: RequestOptions): Promise<OcrResponse> {
    return this.request('POST', '/ocr', {}, toForm('files', files), options);
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    query: Query,
    body: FormData | object | undefined,
    options: RequestOptions | undefined,
  ): Promise<T> {
    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(query)) {
      // null means "worker default", so the parameter is left out.
      if (value !== null && value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    const init: RequestInit = { method, signal: options?.signal };
    if (body instanceof FormData) {
      // fetch sets the multipart boundary itself.
      init.body = body;
    } else if (body !== undefined) {
      init.body = JSON.stringify(body);
      init.headers = { 'content-type': 'application/json' };
    }

    const res = await fetch(url, init);
    if (!res.ok) {
      throw new WorkerError(path, res.status, await readDetail(res));
    }
    return (await res.json()) as T;
  }
}

function toForm(field: string, files: UploadInput[]): FormData {
  const form = new FormData();
  for (const file of files) {
    form.append(field, file.data, file.filename);
  }
  return form;
}

async function readDetail(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    const json = JSON.parse(text);
    return json?.detail ?? json;
  } catch {
    return text;
  }
}
