import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  // Any origin, so the Vite dev server can call the API directly.
  app.enableCors();
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
