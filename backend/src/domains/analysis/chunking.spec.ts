import { chunkSegments } from './chunking.js';

const seg = (
  index: number,
  start: number,
  end: number,
  text = `s${index}`,
) => ({
  index,
  start,
  end,
  text,
});

describe('chunkSegments', () => {
  it('groups consecutive segments up to the max duration', () => {
    const chunks = chunkSegments([
      seg(0, 0, 10),
      seg(1, 10, 20),
      seg(2, 20, 30), // ends exactly at 30: still fits
      seg(3, 30, 35),
      seg(4, 35, 50),
    ]);

    expect(chunks).toEqual([
      {
        index: 0,
        startSegment: 0,
        endSegment: 2,
        start: 0,
        end: 30,
        text: 's0 s1 s2',
      },
      {
        index: 1,
        startSegment: 3,
        endSegment: 4,
        start: 30,
        end: 50,
        text: 's3 s4',
      },
    ]);
  });

  it('keeps a segment longer than the max duration whole, on its own', () => {
    const chunks = chunkSegments([seg(0, 0, 5), seg(1, 5, 50), seg(2, 50, 55)]);

    expect(chunks.map((c) => [c.startSegment, c.endSegment])).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
    ]);
  });

  it('measures from the first segment start, so gaps count', () => {
    const chunks = chunkSegments([seg(0, 0, 5), seg(1, 40, 45)]);

    expect(chunks).toHaveLength(2);
  });

  it('trims text and skips empty segments', () => {
    const chunks = chunkSegments([
      seg(0, 0, 2, ' Hallo'),
      seg(1, 2, 3, '   '),
      seg(2, 3, 5, ' Welt '),
    ]);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe('Hallo Welt');
    expect(chunks[0].endSegment).toBe(2);
  });

  it('orders by segment index and handles no segments', () => {
    expect(chunkSegments([])).toEqual([]);
    expect(
      chunkSegments([seg(1, 5, 10), seg(0, 0, 5)]).map((c) => c.text),
    ).toEqual(['s0 s1']);
  });

  it('accepts a custom max duration', () => {
    expect(chunkSegments([seg(0, 0, 5), seg(1, 5, 10)], 5)).toHaveLength(2);
  });
});
