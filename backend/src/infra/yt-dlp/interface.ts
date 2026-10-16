export const YT_DLP = Symbol('YT_DLP');

/** The fields of yt-dlp's info dict that we read. The rest is kept as metadata. */
export interface VideoInfo {
  id: string;
  title: string;
  extractor: string; // e.g. "youtube"
  webpage_url: string;
  channel?: string | null;
  channel_id?: string | null;
  description?: string | null;
  timestamp?: number | null; // unix seconds
  upload_date?: string | null; // YYYYMMDD
  duration?: number | null; // seconds
  live_status?: string | null; // "not_live", "is_live", "is_upcoming", "was_live", ...
  [key: string]: unknown;
}

export interface YtDlp {
  /** Reads a single video's info dict without downloading it. */
  fetchInfo(
    url: string,
    options?: { signal?: AbortSignal },
  ): Promise<VideoInfo>;

  /**
   * Downloads the best format at or below maxHeight as mp4 to
   * `${outBase}.mp4`. Returns the path of the finished file.
   */
  download(
    url: string,
    outBase: string,
    options: { maxHeight: number; signal?: AbortSignal },
  ): Promise<string>;
}
