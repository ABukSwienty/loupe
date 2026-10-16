import type { TranscriptionSegment } from './analysis.model.js';

export type TranscriptionChunkDraft = {
  index: number;
  startSegment: number;
  endSegment: number;
  start: number;
  end: number;
  text: string;
};

/**
 * Groups consecutive segments into chunks of at most maxDuration seconds,
 * measured from the first segment's start to the last one's end. Segments are
 * never split, so a segment longer than maxDuration becomes a chunk of its own.
 * Segments with no text are skipped.
 */
export function chunkSegments(
  segments: Pick<TranscriptionSegment, 'index' | 'start' | 'end' | 'text'>[],
  maxDuration = 30,
): TranscriptionChunkDraft[] {
  const chunks: TranscriptionChunkDraft[] = [];
  let current: typeof segments = [];

  const flush = () => {
    if (current.length === 0) return;
    const first = current[0];
    const last = current[current.length - 1];
    chunks.push({
      index: chunks.length,
      startSegment: first.index,
      endSegment: last.index,
      start: first.start,
      end: last.end,
      text: current.map((s) => s.text.trim()).join(' '),
    });
    current = [];
  };

  const ordered = [...segments].sort((a, b) => a.index - b.index);
  for (const segment of ordered) {
    if (segment.text.trim() === '') continue;
    if (current.length > 0 && segment.end - current[0].start > maxDuration) {
      flush();
    }
    current.push(segment);
  }
  flush();

  return chunks;
}
