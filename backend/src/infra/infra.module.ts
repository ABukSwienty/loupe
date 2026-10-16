import { Module } from '@nestjs/common';
import { QueueModule } from './queue/queue.module.js';
import { StoreModule } from './store/store.module.js';
import { YtDlpModule } from './yt-dlp/yt-dlp.module.js';
import { WorkerClientModule } from './worker-client/worker-client.module.js';

@Module({
  imports: [StoreModule, QueueModule, WorkerClientModule, YtDlpModule],
  exports: [StoreModule, QueueModule, WorkerClientModule, YtDlpModule],
})
export class InfraModule {}
