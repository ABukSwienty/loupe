import { Module } from '@nestjs/common';
import { InfraModule } from '../../infra/infra.module.js';
import { GroupsModule } from '../groups/groups.module.js';
import { VideosModule } from '../videos/videos.module.js';
import { SearchController } from './search.controller.js';
import { SearchService } from './search.service.js';

@Module({
  imports: [InfraModule, GroupsModule, VideosModule],
  controllers: [SearchController],
  providers: [SearchService],
  exports: [SearchService],
})
export class SearchModule {}
