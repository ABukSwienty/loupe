import { Module } from '@nestjs/common';
import { InfraModule } from '../../infra/infra.module.js';
import { JobsController } from './jobs.controller.js';

@Module({
  imports: [InfraModule],
  controllers: [JobsController],
})
export class JobsModule {}
