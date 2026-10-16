import { Module } from '@nestjs/common';
import { AnalysisModule } from './analysis/analysis.module.js';
import { GroupsModule } from './groups/groups.module.js';
import { JobsModule } from './jobs/jobs.module.js';
import { SearchModule } from './search/search.module.js';
import { VideosModule } from './videos/videos.module.js';

@Module({
  imports: [
    VideosModule,
    GroupsModule,
    AnalysisModule,
    JobsModule,
    SearchModule,
  ],
})
export class DomainsModule {}
