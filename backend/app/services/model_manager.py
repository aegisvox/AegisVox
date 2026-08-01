import threading
import urllib.request
from pathlib import Path
from typing import Callable, Optional
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

INSTALL_STATE = {
    "in_progress": False,
    "progress": 0.0,
    "message": "Waiting for installation.",
    "error": None,
}
INSTALL_LOCK = threading.Lock()

class DownloadProgressBar(tqdm):
    """Provides a CLI progress bar for raw HTTP file downloads."""

    def update_to(self, b=1, bsize=1, tsize=None):
        if tsize is not None:
            self.total = tsize
        self.update(b * bsize - self.n)


def _set_install_state(
    *,
    in_progress: Optional[bool] = None,
    progress: Optional[float] = None,
    message: Optional[str] = None,
    error: Optional[str] = None,
) -> None:
    with INSTALL_LOCK:
        if in_progress is not None:
            INSTALL_STATE["in_progress"] = in_progress
        if progress is not None:
            INSTALL_STATE["progress"] = float(progress)
        if message is not None:
            INSTALL_STATE["message"] = message
        if error is not None:
            INSTALL_STATE["error"] = error


def download_file_with_progress(
    url: str,
    output_path: Path,
    model_name: str,
    progress_callback: Optional[Callable[[int, int], None]] = None,
) -> None:
    """Downloads a file over HTTP with optional progress callbacks."""
    print(f"\n📥 [Model Manager] Downloading {model_name}...")
    print(f"🔗 Source URL: {url}")
    print(f"📂 Saving to: {output_path}")

    def reporthook(block_num: int, block_size: int, total_size: int) -> None:
        if progress_callback and total_size:
            progress_callback(block_num * block_size, total_size)

    urllib.request.urlretrieve(url, filename=output_path, reporthook=reporthook)
    print(f"✅ [Model Manager] Successfully installed {model_name}!\n")


def is_whisper_ready() -> bool:
    return (WHISPER_DIR / "base.en").exists()


def is_llm_ready() -> bool:
    return (LLM_DIR / "gemma-4-E2B-it.litertlm").exists()


def is_tts_ready() -> bool:
    try:
        import kokoro  # noqa: F401
        return True
    except Exception:
        return False


def get_models_status() -> dict:
    with INSTALL_LOCK:
        return {
            "llmReady": is_llm_ready(),
            "whisperReady": is_whisper_ready(),
            "ttsReady": is_tts_ready(),
            "installing": INSTALL_STATE["in_progress"],
            "progress": INSTALL_STATE["progress"],
            "message": INSTALL_STATE["message"],
            "error": INSTALL_STATE["error"],
        }


def install_missing_models() -> None:
    if INSTALL_STATE["in_progress"]:
        return

    _set_install_state(in_progress=True, progress=0.0, message="Preparing Gemma installation...", error=None)

    try:
        if not is_llm_ready():
            llm_url = "https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it.litertlm"
            llm_path = LLM_DIR / "gemma-4-E2B-it.litertlm"

            def llm_progress(downloaded: int, total: int) -> None:
                if total:
                    chunk_progress = min(1.0, max(0.0, downloaded / total))
                    _set_install_state(progress=chunk_progress, message=f"Downloading Gemma LLM... {int(chunk_progress * 100)}%")

            download_file_with_progress(llm_url, llm_path, "Gemma LiteRT", progress_callback=llm_progress)
            _set_install_state(progress=1.0, message="Gemma LLM installed.")
        else:
            _set_install_state(progress=1.0, message="Gemma LLM already installed.")

    except Exception as exc:
        _set_install_state(in_progress=False, progress=1.0, message="Gemma installation failed.", error=str(exc))
        raise
    else:
        _set_install_state(in_progress=False, progress=1.0, message="Gemma installation complete.")


def ensure_models_ready() -> None:
    install_missing_models()


if __name__ == "__main__":
    ensure_models_ready()
