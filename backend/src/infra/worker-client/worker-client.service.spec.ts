import { WorkerClientService, WorkerError } from './worker-client.service.js';

describe('WorkerClientService', () => {
  const client = new WorkerClientService('http://worker.test');
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  it('sends files as multipart and maps params to snake_case query, leaving out nulls', async () => {
    fetchMock.mockResolvedValue(json({ scenes: [] }));
    const data = new Blob(['video']);

    await client.scenes(
      { data, filename: 'talk.mp4' },
      {
        detector: 'content',
        threshold: null,
        keyframes: true,
        keyframeWidth: 256,
      },
    );

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      'http://worker.test/scenes?detector=content&keyframes=true&keyframe_width=256',
    );
    expect(init?.method).toBe('POST');
    const file = (init!.body as FormData).get('file') as File;
    expect(file.name).toBe('talk.mp4');
  });

  it.each([
    ['embedDocuments', '/embed/document'],
    ['embedImageQueries', '/embed/image-query'],
  ] as const)('%s sends texts as JSON to %s', async (method, path) => {
    fetchMock.mockResolvedValue(json({ vectors: [] }));

    await client[method](['a', 'b']);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`http://worker.test${path}`);
    expect(init?.body).toBe('{"texts":["a","b"]}');
  });

  it('passes the abort signal to fetch', async () => {
    fetchMock.mockResolvedValue(json({ status: 'ok' }));
    const controller = new AbortController();

    await client.health({ signal: controller.signal });

    expect(fetchMock.mock.calls[0][1]?.signal).toBe(controller.signal);
  });

  it('throws WorkerError with the FastAPI detail on failure', async () => {
    fetchMock.mockResolvedValue(
      json({ detail: 'texts must not be empty' }, 400),
    );

    const error = await client.embedDocuments([]).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(WorkerError);
    expect(error).toMatchObject({
      status: 400,
      detail: 'texts must not be empty',
    });
  });
});
