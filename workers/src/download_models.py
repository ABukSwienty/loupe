from dotenv import load_dotenv

# No override: `make download-models` sets HF_HUB_OFFLINE=0, which must win
# over an HF_HUB_OFFLINE=1 in .env, or nothing can be downloaded.
load_dotenv()

import os

import numpy as np
from faster_whisper import download_model
from huggingface_hub import snapshot_download

print("pyannote Community-1 ...")
snapshot_download(
    "pyannote/speaker-diarization-community-1", token=os.environ.get("HF_TOKEN")
)

for name in ["small", "large-v3-turbo"]:
    print(f"faster-whisper {name} ...")
    download_model(name)

print("SigLIP 2 ...")
snapshot_download("google/siglip2-base-patch16-224")

print("RapidOCR ...")
from rapidocr import RapidOCR

RapidOCR()(np.zeros((64, 64, 3), dtype=np.uint8))  # first run downloads its models

print("bge-m3 ...")
snapshot_download("BAAI/bge-m3")

print("Done.")
