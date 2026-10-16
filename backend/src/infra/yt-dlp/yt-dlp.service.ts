import { execFile } from 'node:child_process';
import type { VideoInfo, YtDlp } from './interface.js';

/** yt-dlp exited with an error. The message is its last ERROR line. */
export class YtDlpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'YtDlpError';
  }
}

/** Runs the yt-dlp binary. Aborting the signal kills the process. */
export class YtDlpService implements YtDlp {
  constructor(private readonly bin: string) {}

  async fetchInfo(
    url: string,
    options?: { signal?: AbortSignal },
  ): Promise<VideoInfo> {
    const stdout = await this.run(
      [
        '--dump-single-json',
        '--skip-download',
        '--no-playlist',
        '--no-warnings',
        '--',
        url,
      ],
      options?.signal,
    );
    return JSON.parse(stdout) as VideoInfo;
  }

  async download(
    url: string,
    outBase: string,
    options: { maxHeight: number; signal?: AbortSignal },
  ): Promise<string> {
    const stdout = await this.run(
      [
        '--no-playlist',
        '--no-progress',
        '--quiet',
        '--no-warnings',
        // Prefers the largest format at or below maxHeight, and h264/aac so
        // the merge into mp4 needs no re-encode.
        '-S',
        `res:${options.maxHeight},vcodec:h264,acodec:aac`,
        '--merge-output-format',
        'mp4',
        '-o',
        `${outBase}.%(ext)s`,
        '--print',
        'after_move:filepath',
        '--',
        url,
      ],
      options.signal,
    );
    const path = stdout.trim().split('\n').at(-1);
    if (!path) throw new YtDlpError('yt-dlp did not report a file path');
    return path;
  }

  private run(args: string[], signal?: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(
        this.bin,
        args,
        // Info dicts run to a few hundred KB; the default 1 MB is too tight
        // for long videos with many formats.
        { signal, maxBuffer: 64 * 1024 * 1024 },
        (err, stdout, stderr) => {
          if (!err) return resolve(stdout);
          if (err.name === 'AbortError') return reject(err);
          const line = stderr
            .split('\n')
            .filter((l) => l.startsWith('ERROR:'))
            .at(-1);
          reject(
            new YtDlpError(line?.replace(/^ERROR:\s*/, '') ?? err.message),
          );
        },
      );
    });
  }
}
