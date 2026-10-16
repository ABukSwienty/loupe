import {
  Global,
  Inject,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { openStore, type Store } from './client.js';

export const STORE = Symbol('STORE');

@Global()
@Module({
  providers: [
    {
      provide: STORE,
      useFactory: (): Store =>
        openStore(process.env.STORE_PATH ?? 'data/loupe.db'),
    },
  ],
  exports: [STORE],
})
export class StoreModule implements OnApplicationShutdown {
  constructor(@Inject(STORE) private readonly store: Store) {}

  onApplicationShutdown() {
    this.store.$client.close();
  }
}
