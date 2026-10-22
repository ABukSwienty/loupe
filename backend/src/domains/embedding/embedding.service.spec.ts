import { eq } from 'drizzle-orm';
import { transcriptionChunks } from '../../infra/store/schema/index.js';
import {
  CHUNK_EMBEDDING_DIM,
  SCENE_EMBEDDING_DIM,
  searchChunkEmbeddings,
  searchSceneEmbeddings,
} from '../../infra/store/vectors.js';
import {
  openAnalysisFixture,
  SCENES_INPUT,
  unit,
  type AnalysisFixture,
} from '../../testing/analysis-fixture.js';
import { SceneDetectionService } from '../scene-detection/scene-detection.service.js';
import { TranscriptionService } from '../transcription/transcription.service.js';
import { EmbeddingService } from './embedding.service.js';

describe('EmbeddingService', () => {
  let f: AnalysisFixture;
  let transcription: TranscriptionService;
  let sceneDetection: SceneDetectionService;
  let embedding: EmbeddingService;

  beforeEach(() => {
    f = openAnalysisFixture();
    transcription = new TranscriptionService(f.store, f.workerClient, f.videos);
    sceneDetection = new SceneDetectionService(
      f.store,
      f.workerClient,
      f.videos,
    );
    embedding = new EmbeddingService(f.store, f.workerClient, sceneDetection);
  });

  afterEach(() => f.close());

  it('embeds transcript chunks with their model', async () => {
    await transcription.transcribe({ videoId: 'v1', language: null });

    const out = await embedding.embedTranscript({ videoId: 'v1' });

    expect(out).toEqual({ model: 'bge-m3', chunks: 2 });
    expect(f.worker.embedDocuments).toHaveBeenCalledWith(
      ['Hallo und', 'tschüss'],
      expect.anything(),
    );
    const [hit] = searchChunkEmbeddings(f.store, unit(CHUNK_EMBEDDING_DIM, 1), {
      k: 1,
      model: 'bge-m3',
    });
    const chunk = f.store
      .select()
      .from(transcriptionChunks)
      .where(eq(transcriptionChunks.id, hit.id))
      .get();
    expect(chunk?.text).toBe('tschüss');
  });

  it('embeds scene keyframes', async () => {
    await sceneDetection.detect(SCENES_INPUT);

    const out = await embedding.embedScenes({ videoId: 'v1' });

    expect(out).toEqual({ model: 'siglip2', scenes: 2 });
    expect(
      searchSceneEmbeddings(f.store, unit(SCENE_EMBEDDING_DIM, 0)),
    ).toHaveLength(2);
  });

  it('fails without a transcription or scenes', async () => {
    await expect(embedding.embedTranscript({ videoId: 'v1' })).rejects.toThrow(
      /run transcribe first/,
    );
    await expect(embedding.embedScenes({ videoId: 'v1' })).rejects.toThrow(
      /run scenes first/,
    );
  });

  it('reports coverage of the current transcription and scenes', async () => {
    const none = { embedded: 0, total: 0, models: [] };
    expect(embedding.coverage('v1')).toEqual({
      transcript: none,
      scenes: none,
    });

    await transcription.transcribe({ videoId: 'v1', language: null });
    await sceneDetection.detect(SCENES_INPUT);
    await embedding.embedTranscript({ videoId: 'v1' });

    expect(embedding.coverage('v1')).toEqual({
      transcript: { embedded: 2, total: 2, models: ['bge-m3'] },
      scenes: { embedded: 0, total: 2, models: [] },
    });
  });
});
