import { Module } from '@nestjs/common';
import { YT_DLP, type YtDlp } from './interface.js';
import { YtDlpService } from './yt-dlp.service.js';

@Module({
  providers: [
    {
      provide: YT_DLP,
      useFactory: (): YtDlp =>
        new YtDlpService(process.env.YT_DLP_PATH ?? 'yt-dlp'),
    },
  ],
  exports: [YT_DLP],
})
export class YtDlpModule {}
