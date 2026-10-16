import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { DomainsModule } from '../domains/domains.module.js';
import { InfraModule } from '../infra/infra.module.js';

@Module({
  imports: [InfraModule, DomainsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
