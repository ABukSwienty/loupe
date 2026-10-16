from dotenv import load_dotenv

load_dotenv(override=True)

import base64
import io
import os
import subprocess
import tempfile
import threading
import warnings
import wave
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

import numpy as np
import torch
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.concurrency import run_in_threadpool
from faster_whisper import WhisperModel
from PIL import Image
from pyannote.audio import Pipeline
from pydantic import BaseModel
from rapidocr import RapidOCR
from scenedetect import AdaptiveDetector, ContentDetector, SceneManager, open_video
from sentence_transformers import SentenceTransformer
from transformers import AutoModel, AutoProcessor

warnings.filterwarnings("ignore", message="std\\(\\): degrees of freedom")

# ---------- configuration (.env) ----------

PYANNOTE_MODEL = os.environ.get(
    "PYANNOTE_MODEL", "pyannote/speaker-diarization-community-1"
)
WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "large-v3-turbo")
EMBED_MODEL = os.environ.get("EMBED_MODEL", "google/siglip2-base-patch16-224")
TEXT_EMBED_MODEL = os.environ.get("TEXT_EMBED_MODEL", "BAAI/bge-m3")

if torch.cuda.is_available():
    DEVICE = "cuda"
elif torch.backends.mps.is_available():
    DEVICE = "mps"
else:
    DEVICE = "cpu"

models: dict = {}
# Models are not safe for parallel use: one job per model at a time
locks = {
    name: threading.Lock()
    for name in ("pyannote", "whisper", "embed", "text_embed", "ocr")
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    models["pyannote"] = Pipeline.from_pretrained(
        PYANNOTE_MODEL, token=os.environ.get("HF_TOKEN")
    )
    models["pyannote"].to(torch.device(DEVICE))

    # faster-whisper supports CUDA or CPU only (no MPS)
    if DEVICE == "cuda":
        models["whisper"] = WhisperModel(
            WHISPER_MODEL, device="cuda", compute_type="float16"
        )
    else:
        models["whisper"] = WhisperModel(
            WHISPER_MODEL,
            device="cpu",
            compute_type="int8",
            cpu_threads=os.cpu_count() or 4,
        )

    # SigLIP 2: images and image-search queries share one vector space
    models["embed"] = AutoModel.from_pretrained(EMBED_MODEL).to(DEVICE).eval()
    models["processor"] = AutoProcessor.from_pretrained(EMBED_MODEL)

    # bge-m3: text-to-text retrieval (transcripts, OCR text)
    models["text_embed"] = SentenceTransformer(TEXT_EMBED_MODEL, device=DEVICE)

    models["ocr"] = RapidOCR()

    print(
        f"Models loaded. device={DEVICE}, whisper={WHISPER_MODEL}, "
        f"embed={EMBED_MODEL}, text_embed={TEXT_EMBED_MODEL}"
    )
    yield
    models.clear()


app = FastAPI(title="ML worker", lifespan=lifespan)


# ---------- shared helpers ----------


async def save_upload(file: UploadFile, tmp: str, name: str = "input") -> Path:
    """Save an upload to the temp dir, keeping its extension."""
    suffix = Path(file.filename or "").suffix
    path = Path(tmp) / f"{name}{suffix}"
    path.write_bytes(await file.read())
    return path


def to_wav(src: Path) -> Path:
    """Convert any audio/video to 16 kHz mono 16-bit WAV."""
    wav = src.parent / "audio_16k.wav"
    result = subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-loglevel",
            "error",
            "-i",
            str(src),
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "pcm_s16le",
            str(wav),
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise HTTPException(400, f"ffmpeg failed: {result.stderr.strip()}")
    return wav


def load_wav(path: Path) -> np.ndarray:
    """Read a 16 kHz mono 16-bit WAV into float32 samples in [-1, 1]."""
    with wave.open(str(path), "rb") as w:
        frames = w.readframes(w.getnframes())
    return np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0


async def read_images(files: list[UploadFile]) -> list[Image.Image]:
    images = []
    for f in files:
        try:
            images.append(Image.open(io.BytesIO(await f.read())).convert("RGB"))
        except Exception:
            raise HTTPException(400, f"Not a readable image: {f.filename}")
    return images


# ---------- diarization ----------


def diarize_wav(wav: Path, num_speakers, min_speakers, max_speakers) -> dict:
    kwargs = {
        k: v
        for k, v in {
            "num_speakers": num_speakers,
            "min_speakers": min_speakers,
            "max_speakers": max_speakers,
        }.items()
        if v is not None
    }

    with locks["pyannote"]:
        output = models["pyannote"](str(wav), **kwargs)

    def to_list(annotation):
        return [
            {"start": round(t.start, 3), "end": round(t.end, 3), "speaker": s}
            for t, s in annotation
        ]

    segments = to_list(output.speaker_diarization)
    return {
        "speakers": sorted({s["speaker"] for s in segments}),
        "segments": segments,  # may overlap
        "exclusive_segments": to_list(
            output.exclusive_speaker_diarization
        ),  # one speaker at a time
    }


# ---------- transcription ----------


def transcribe_wav(wav: Path, language: str | None) -> dict:
    with locks["whisper"]:
        segments, info = models["whisper"].transcribe(
            load_wav(wav),  # NumPy array: skips faster-whisper's PyAV decoding
            language=language,  # None = auto-detect
            word_timestamps=True,
            vad_filter=True,  # skips silence, reduces hallucinated text
        )
        # `segments` is a lazy generator: the transcription runs inside this loop
        result = [
            {
                "start": round(seg.start, 3),
                "end": round(seg.end, 3),
                "text": seg.text.strip(),
                "avg_logprob": round(seg.avg_logprob, 3),
                "no_speech_prob": round(seg.no_speech_prob, 3),
                "words": [
                    {
                        "start": round(w.start, 3),
                        "end": round(w.end, 3),
                        "word": w.word.strip(),
                        "probability": round(w.probability, 3),
                    }
                    for w in (seg.words or [])
                ],
            }
            for seg in segments
        ]

    return {
        "language": info.language,
        "language_probability": round(info.language_probability, 3),
        "duration": round(info.duration, 3),
        "segments": result,
    }


# ---------- scene detection + keyframes ----------


def extract_frame(video: Path, t: float, width: int) -> bytes:
    """Grab one frame at time t (seconds) as JPEG bytes."""
    result = subprocess.run(
        [
            "ffmpeg",
            "-loglevel",
            "error",
            "-ss",
            f"{t:.3f}",
            "-i",
            str(video),
            "-frames:v",
            "1",
            "-vf",
            f"scale={width}:-2",
            "-q:v",
            "3",
            "-f",
            "image2pipe",
            "-vcodec",
            "mjpeg",
            "-",
        ],
        capture_output=True,
    )
    if result.returncode != 0 or not result.stdout:
        raise HTTPException(
            500,
            f"Frame extraction failed at {t:.3f}s: {result.stderr.decode().strip()}",
        )
    return result.stdout


def detect_scenes(
    path: Path,
    detector: str,
    threshold: float | None,
    keyframes: bool,
    keyframe_width: int,
) -> dict:
    try:
        video = open_video(str(path))
    except Exception as e:
        raise HTTPException(400, f"Cannot open video: {e}")

    if detector == "content":
        det = ContentDetector(threshold=threshold if threshold is not None else 27.0)
    else:
        det = AdaptiveDetector(
            adaptive_threshold=threshold if threshold is not None else 3.0
        )

    manager = SceneManager()  # downscales frames automatically for speed
    manager.add_detector(det)
    manager.detect_scenes(video)
    scene_list = manager.get_scene_list(start_in_scene=True)  # no cuts -> one scene

    scenes = []
    for i, (start, end) in enumerate(scene_list):
        scene = {
            "index": i,
            "start": round(start.get_seconds(), 3),
            "end": round(end.get_seconds(), 3),
            "start_frame": start.get_frames(),
            "end_frame": end.get_frames(),
        }
        if keyframes:
            mid = (scene["start"] + scene["end"]) / 2
            jpeg = extract_frame(path, mid, keyframe_width)
            scene["keyframe"] = {
                "time": round(mid, 3),
                "jpeg_base64": base64.b64encode(jpeg).decode(),
            }
        scenes.append(scene)

    return {
        "fps": round(float(video.frame_rate), 3),
        "duration": round(video.duration.get_seconds(), 3),
        "detector": detector,
        "scene_count": len(scenes),
        "scenes": scenes,
    }


# ---------- image embeddings (SigLIP 2) ----------


def _features(out) -> torch.Tensor:
    # Some transformers versions return an output object instead of a tensor
    return out if isinstance(out, torch.Tensor) else out.pooler_output


def embed_images(images: list[Image.Image], batch_size: int = 32) -> list[list[float]]:
    vectors = []
    with locks["embed"]:
        for i in range(0, len(images), batch_size):
            inputs = models["processor"](
                images=images[i : i + batch_size], return_tensors="pt"
            ).to(DEVICE)
            with torch.no_grad():
                feats = _features(models["embed"].get_image_features(**inputs))
            feats = torch.nn.functional.normalize(
                feats, dim=-1
            )  # unit length: dot product = cosine
            vectors.extend(feats.float().cpu().tolist())
    return vectors


def embed_image_queries(texts: list[str], batch_size: int = 64) -> list[list[float]]:
    """SigLIP text vectors: only comparable with SigLIP image vectors."""
    vectors = []
    with locks["embed"]:
        for i in range(0, len(texts), batch_size):
            # SigLIP was trained with max_length padding to 64 tokens
            inputs = models["processor"](
                text=texts[i : i + batch_size],
                padding="max_length",
                max_length=64,
                truncation=True,
                return_tensors="pt",
            ).to(DEVICE)
            with torch.no_grad():
                feats = _features(models["embed"].get_text_features(**inputs))
            feats = torch.nn.functional.normalize(feats, dim=-1)
            vectors.extend(feats.float().cpu().tolist())
    return vectors


# ---------- text embeddings (bge-m3) ----------


def embed_documents(texts: list[str]) -> list[list[float]]:
    with locks["text_embed"]:
        vectors = models["text_embed"].encode(
            texts,
            batch_size=16,
            normalize_embeddings=True,  # unit length: dot product = cosine
        )
    return vectors.tolist()


# ---------- OCR ----------


def ocr_image(image: Image.Image) -> list[dict]:
    bgr = np.ascontiguousarray(
        np.array(image)[:, :, ::-1]
    )  # RapidOCR expects OpenCV's BGR order
    with locks["ocr"]:
        result = models["ocr"](bgr)
    if result.boxes is None or result.txts is None:
        return []
    return [
        {
            "text": text,
            "score": round(float(score), 3),
            "box": np.asarray(box).round(1).tolist(),
        }
        for box, text, score in zip(result.boxes, result.txts, result.scores)
    ]


# ---------- endpoints ----------


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "device": DEVICE,
        "models": {
            "diarization": PYANNOTE_MODEL,
            "whisper": WHISPER_MODEL,
            "embed": EMBED_MODEL,
            "text_embed": TEXT_EMBED_MODEL,
            "ocr": "rapidocr",
        },
        "loaded": sorted(models.keys()),
    }


@app.post("/diarize")
async def diarize(
    file: UploadFile = File(...),
    num_speakers: int | None = Query(None, ge=1),
    min_speakers: int | None = Query(None, ge=1),
    max_speakers: int | None = Query(None, ge=1),
):
    with tempfile.TemporaryDirectory() as tmp:
        wav = await run_in_threadpool(to_wav, await save_upload(file, tmp))
        return await run_in_threadpool(
            diarize_wav, wav, num_speakers, min_speakers, max_speakers
        )


@app.post("/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    language: str | None = Query(
        None, description="ISO code such as 'en' or 'de'; empty = auto-detect"
    ),
):
    with tempfile.TemporaryDirectory() as tmp:
        wav = await run_in_threadpool(to_wav, await save_upload(file, tmp))
        return await run_in_threadpool(transcribe_wav, wav, language)


@app.post("/scenes")
async def scenes(
    file: UploadFile = File(...),
    detector: Literal["adaptive", "content"] = Query("adaptive"),
    threshold: float | None = Query(
        None,
        description="adaptive default 3.0, content default 27.0; lower = more cuts",
    ),
    keyframes: bool = Query(
        False, description="include one base64 JPEG per scene (middle frame)"
    ),
    keyframe_width: int = Query(512, ge=64, le=1920),
):
    with tempfile.TemporaryDirectory() as tmp:
        path = await save_upload(file, tmp)
        return await run_in_threadpool(
            detect_scenes, path, detector, threshold, keyframes, keyframe_width
        )


class TextsRequest(BaseModel):
    texts: list[str]


@app.post("/embed/image-query")
async def embed_image_query(body: TextsRequest):
    """Text -> SigLIP vector, for searching images/keyframes."""
    if not body.texts:
        raise HTTPException(400, "texts must not be empty")
    vectors = await run_in_threadpool(embed_image_queries, body.texts)
    return {"model": EMBED_MODEL, "dim": len(vectors[0]), "vectors": vectors}


@app.post("/embed/image")
async def embed_image(files: list[UploadFile] = File(...)):
    images = await read_images(files)
    vectors = await run_in_threadpool(embed_images, images)
    return {
        "model": EMBED_MODEL,
        "dim": len(vectors[0]),
        "results": [
            {"filename": f.filename, "vector": v} for f, v in zip(files, vectors)
        ],
    }


@app.post("/embed/document")
async def embed_document(body: TextsRequest):
    """Text -> bge-m3 vector, for text-to-text retrieval (transcripts, OCR)."""
    if not body.texts:
        raise HTTPException(400, "texts must not be empty")
    vectors = await run_in_threadpool(embed_documents, body.texts)
    return {"model": TEXT_EMBED_MODEL, "dim": len(vectors[0]), "vectors": vectors}


@app.post("/ocr")
async def ocr(files: list[UploadFile] = File(...)):
    images = await read_images(files)
    results = []
    for f, img in zip(files, images):
        results.append(
            {"filename": f.filename, "lines": await run_in_threadpool(ocr_image, img)}
        )
    return {"results": results}
