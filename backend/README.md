# Loupe backend

NestJS API for Loupe. It ingests YouTube videos with yt-dlp, queues the analysis steps and runs them against the Python worker, stores the results in SQLite with sqlite-vec, and serves the results and search endpoints.

See the [main README](../README.md) for setup, and [`CLAUDE.md`](../CLAUDE.md) for the architecture and every endpoint.

```bash
npm install
npm run start:dev   # http://localhost:3000; creates data/loupe.db and runs migrations
npm test            # vitest
npm run lint        # oxlint
```
