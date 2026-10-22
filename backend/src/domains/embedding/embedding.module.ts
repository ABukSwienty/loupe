import { Module } from '@nestjs/common';
import { InfraModule } from '../../infra/infra.module.js';
import { SceneDetectionModule } from '../scene-detection/scene-detection.module.js';
import { EMBEDDER } from './interface.js';
import { EmbeddingService } from './embedding.service.js';

@Module({
  imports: [InfraModule, SceneDetectionModule],
  providers: [{ provide: EMBEDDER, useClass: EmbeddingService }],
  exports: [EMBEDDER],
})
export class EmbeddingModule {}
