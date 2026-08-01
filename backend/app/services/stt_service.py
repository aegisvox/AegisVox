import io
from pathlib import Path
from faster_whisper import WhisperModel

WHISPER_DIR = Path(__file__).resolve().parent.parent.parent / "models" / "whisper"

class STTService:
    def __init__(self, model_size: str = "base.en", device: str = "cpu", compute_type: str = "int8"):
        self.model = None
        self.model_size = model_size
        self.device = device
        self.compute_type = compute_type

    def _load_model(self) -> None:
        model_path = WHISPER_DIR / self.model_size
        if not model_path.exists():
            raise FileNotFoundError("Faster-Whisper model is not installed locally.")

        print("⚡ [STT] Loading Faster-Whisper from local cache...")
        self.model = WhisperModel(
            model_size_or_path=str(model_path),
            device=self.device,
            compute_type=self.compute_type,
        )
        print("🟢 [STT] Faster-Whisper online!")

    def transcribe_bytes(self, audio_bytes: bytes) -> str:
        """Converts raw audio bytes into transcribed UTF-8 text string."""
        if self.model is None:
            self._load_model()

        audio_stream = io.BytesIO(audio_bytes)

        segments, _ = self.model.transcribe(
            audio=audio_stream,
            beam_size=5,
            vad_filter=True,
            vad_parameters=dict(min_silence_duration_ms=500),
        )

        transcript = " ".join([segment.text for segment in segments]).strip()
        return transcript
