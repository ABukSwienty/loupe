import { Module } from '@nestjs/common';
import { InfraModule } from '../../infra/infra.module.js';
import { GroupsController } from './groups.controller.js';
import { GroupsService } from './groups.service.js';

@Module({
  imports: [InfraModule],
  controllers: [GroupsController],
  providers: [GroupsService],
  exports: [GroupsService],
})
export class GroupsModule {}
