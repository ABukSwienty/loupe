import { canonicalYoutubeUrl } from './youtube-url.js';

describe('canonicalYoutubeUrl', () => {
  const canonical = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';

  it.each([
    'https://www.youtube.com/watch?v=jNQXAC9IVRw',
    'https://youtube.com/watch?v=jNQXAC9IVRw&list=PL123&t=10s',
    'http://m.youtube.com/watch?v=jNQXAC9IVRw',
    'https://youtu.be/jNQXAC9IVRw?si=abc',
    'https://www.youtube.com/shorts/jNQXAC9IVRw',
    'https://www.youtube.com/live/jNQXAC9IVRw',
    'https://www.youtube.com/embed/jNQXAC9IVRw',
  ])('canonicalises %s', (input) => {
    expect(canonicalYoutubeUrl(input)).toBe(canonical);
  });

  it.each([
    'not a url',
    'https://vimeo.com/123',
    'https://www.youtube.com/playlist?list=PL123',
    'https://www.youtube.com/@jawed',
    'https://www.youtube.com/watch?v=short',
    'https://youtube.com.evil.example/watch?v=jNQXAC9IVRw',
    'file:///etc/passwd',
  ])('rejects %s', (input) => {
    expect(canonicalYoutubeUrl(input)).toBeNull();
  });
});
