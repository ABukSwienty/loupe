# Loupe worker

FastAPI app that wraps Loupe's ML models: transcription, diarization, scene detection, OCR and embeddings. It loads the models once at startup, takes a file or text, and returns JSON. Jobs and storage are handled by the backend.

See the [main README](../README.md) for setup, including the Hugging Face token in `.env`.

```bash
uv sync
uv run python src/download_models.py   # once, about 5.5 GB
uv run fastapi dev src/main.py         # http://localhost:8000, API docs at /docs
```

Model names can be overridden with `WHISPER_MODEL`, `PYANNOTE_MODEL`, `EMBED_MODEL` and `TEXT_EMBED_MODEL`. The backend's vector tables assume 768 dimensions for the image model and 1024 for the text model, so a model with a different size needs a new migration there.
