const HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
]);

const ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * Returns the canonical watch URL for a YouTube video link, or null if the
 * input is not one. Accepts watch, youtu.be, shorts, live and embed links;
 * playlist and tracking parameters are dropped.
 */
export function canonicalYoutubeUrl(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (!HOSTS.has(url.hostname)) return null;

  const [first, second] = url.pathname.split('/').filter(Boolean);
  const id =
    url.hostname === 'youtu.be'
      ? first
      : first === 'watch'
        ? url.searchParams.get('v')
        : first === 'shorts' || first === 'live' || first === 'embed'
          ? second
          : null;

  return id && ID.test(id) ? `https://www.youtube.com/watch?v=${id}` : null;
}
