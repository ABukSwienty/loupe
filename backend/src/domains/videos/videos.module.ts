import { Module, type OnModuleInit } from '@nestjs/common';
import { InfraModule } from '../../infra/infra.module.js';
import { QueueRunner } from '../../infra/queue/queue.runner.js';
import { VideosController } from './videos.controller.js';
import {
  DOWNLOAD_JOB,
  VideosService,
  type DownloadJobInput,
} from './videos.service.js';

@Module({
  imports: [InfraModule],
  controllers: [VideosController],
  providers: [VideosService],
  exports: [VideosService],
})
export class VideosModule implements OnModuleInit {
  constructor(
    private readonly runner: QueueRunner,
    private readonly videos: VideosService,
  ) {}

  onModuleInit() {
    this.runner.register<DownloadJobInput, unknown>(
      DOWNLOAD_JOB,
      (input, { signal }) => this.videos.download(input, signal),
    );
  }
}
