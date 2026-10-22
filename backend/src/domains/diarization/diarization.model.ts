import type {
  diarizations,
  diarizationSegments,
} from '../../infra/store/schema/index.js';

export type SpeakerTurn = Omit<
  typeof diarizationSegments.$inferSelect,
  'id' | 'diarizationId' | 'exclusive'
>;

export type Diarization = typeof diarizations.$inferSelect & {
  segments: SpeakerTurn[]; // may overlap
  exclusiveSegments: SpeakerTurn[]; // one speaker at a time
};

export type DiarizationSummary = {
  id: string;
  createdAt: number;
  speakers: number;
  segments: number;
};

export function toDiarization(
  row: typeof diarizations.$inferSelect,
  segments: (typeof diarizationSegments.$inferSelect)[],
): Diarization {
  const turn = ({
    start,
    end,
    speaker,
  }: typeof diarizationSegments.$inferSelect): SpeakerTurn => ({
    start,
    end,
    speaker,
  });
  return {
    ...row,
    segments: segments.filter((s) => !s.exclusive).map(turn),
    exclusiveSegments: segments.filter((s) => s.exclusive).map(turn),
  };
}
