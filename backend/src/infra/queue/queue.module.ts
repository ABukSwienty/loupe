import { Module } from '@nestjs/common';
import { JOB_QUEUE } from './interface.js';
import { QueueRunner } from './queue.runner.js';
import { QueueService } from './queue.service.js';

@Module({
  providers: [{ provide: JOB_QUEUE, useClass: QueueService }, QueueRunner],
  exports: [JOB_QUEUE, QueueRunner],
})
export class QueueModule {}
