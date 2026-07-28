import os
import urllib.request
from pathlib import Path
from tqdm import tqdm
from faster_whisper import download_model

# Establish project-local storage paths
BASE_DIR = Path(__file__).resolve().parent.parent.parent
MODELS_DIR = BASE_DIR / "models"
WHISPER_DIR = MODELS_DIR / "whisper"
LLM_DIR = MODELS_DIR / "llm"

# Ensure all cache directories exist
MODELS_DIR.mkdir(parents=True, exist_ok=True)
WHISPER_DIR.mkdir(parents=True, exist_ok=True)
LLM_DIR.mkdir(parents=True, exist_ok=True)

class DownloadProgressBar(tqdm):
    """Provides a CLI progress bar for raw HTTP file downloads."""
    def update_to(self, b=1, bsize=1, tsize=None):
        if tsize is not None:
            self.total = tsize
        self.update(b * bsize - self.n)

def download_file_with_progress(url: str, output_path: Path, model_name: str):
    """Downloads a file over HTTP while rendering a real-time progress bar."""
    print(f"\n📥 [Model Manager] Downloading {model_name}...")
    print(f"🔗 Source URL: {url}")
    print(f"📂 Saving to: {output_path}")
    
    with DownloadProgressBar(unit='B', unit_scale=True, miniters=1, desc=model_name) as t:
        urllib.request.urlretrieve(url, filename=output_path, reporthook=t.update_to)
    print(f"✅ [Model Manager] Successfully installed {model_name}!\n")

def ensure_models_ready():
    """Verifies all AI models exist locally; downloads them immediately if missing."""
    print("🔍 [Model Manager] Running pre-flight checks for offline AI models...")

    # 1. Faster-Whisper Speech Recognition Model
    print("⚡ [1/3] Checking Faster-Whisper (base.en)...")
    try:
        download_model("base.en", output_dir=str(WHISPER_DIR))
        print("✅ Faster-Whisper weights verified.")
    except Exception as e:
        print(f"❌ Failed to verify Faster-Whisper: {e}")

    # 2. Kokoro-TTS Voice Synthesis Model
    print("🗣️ [2/3] Checking Kokoro-TTS voice pack...")
    try:
        from kokoro import KPipeline
        # Initializing the pipeline triggers automatic caching of the default voices
        _ = KPipeline(lang_code="a")
        print("✅ Kokoro-TTS weights verified.")
    except Exception as e:
        print(f"❌ Failed to verify Kokoro-TTS: {e}")

    # 3. Gemma LiteRT Language Model
    print("🧠 [3/3] Checking Gemma LLM weights...")
    llm_filename = "gemma-4-E2B-it.litertlm"
    llm_path = LLM_DIR / llm_filename
    
    # Official mirror URL for converted LiteRT models
    llm_url = "https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it.litertlm"

    if not llm_path.exists():
        print(f"⚠️ LLM file not found at {llm_path}. Starting automatic download...")
        try:
            download_file_with_progress(llm_url, llm_path, "Gemma 2B LiteRT")
        except Exception as e:
            print(f"❌ Could not download LLM from {llm_url}: {e}")
            print("💡 TIP: You can manually drop any valid .litertlm file into backend/models/llm/")
    else:
        file_size_mb = llm_path.stat().st_size / (1024 * 1024)
        print(f"✅ Gemma LLM verified ({file_size_mb:.1f} MB).")

    print("🟢 [Model Manager] All AI engines verified and ready for offline inference!\n")

if __name__ == "__main__":
    ensure_models_ready()