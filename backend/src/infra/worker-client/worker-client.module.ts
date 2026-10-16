import { Module } from '@nestjs/common';
import { WORKER_CLIENT, type WorkerClient } from './interface.js';
import { WorkerClientService } from './worker-client.service.js';

@Module({
  providers: [
    {
      provide: WORKER_CLIENT,
      useFactory: (): WorkerClient =>
        new WorkerClientService(
          process.env.WORKER_URL ?? 'http://127.0.0.1:8000',
        ),
    },
  ],
  exports: [WORKER_CLIENT],
})
export class WorkerClientModule {}
