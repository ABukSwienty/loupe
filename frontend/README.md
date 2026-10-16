# Loupe frontend

Vite + React client for Loupe: ingest videos, run the analysis steps, browse the results and search.

It talks to the backend at `VITE_API_URL` (default `http://localhost:3000`; see `.env.example`). See the [main README](../README.md) for setup.

```bash
npm install
npm run dev     # http://localhost:5173
npm run build   # type-check and build
npm run lint
```
