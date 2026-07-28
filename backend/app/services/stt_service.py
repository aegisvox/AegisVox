import io
from pathlib import Path
from faster_whisper import WhisperModel

WHISPER_DIR = Path(__file__).resolve().parent.parent.parent / "models" / "whisper"

class STTService:
    def __init__(self, model_size: str = "base.en", device: str = "cpu", compute_type: str = "int8"):
        print("⚡ [STT] Loading Faster-Whisper from local cache...")
        self.model = WhisperModel(
            model_size_or_path=model_size,
            device=device,
            compute_type=compute_type,
            download_root=str(WHISPER_DIR)
        )
        print("🟢 [STT] Faster-Whisper online!")

    def transcribe_bytes(self, audio_bytes: bytes) -> str:
        """Converts raw audio bytes into transcribed UTF-8 text string."""
        audio_stream = io.BytesIO(audio_bytes)
        
        # VAD automatically strips background noise and silence
        segments, _ = self.model.transcribe(
            audio=audio_stream,
            beam_size=5,
            vad_filter=True,
            vad_parameters=dict(min_silence_duration_ms=500)
        )
        
        transcript = " ".join([segment.text for segment in segments]).strip()
        return transcript