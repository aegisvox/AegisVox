import io
import os
import re
import torch
import soundfile as sf
from kokoro import KPipeline

class TTSService:
    def __init__(self):
        print("[TTS] Initializing Kokoro-TTS engine...")
        # Dictionary to cache language pipelines in RAM/VRAM
        self.pipelines = {}
        
        # Pre-load American English ('a') by default so the first response is instant
        self.get_pipeline("a")
        
        # Directory where you can store custom cloned voice .pt files
        self.custom_voices_dir = "backend/models/voices"
        os.makedirs(self.custom_voices_dir, exist_ok=True)
        
        print("[TTS] Kokoro-TTS online and ready for all 54 voices & streaming!")

    def get_pipeline(self, lang_code: str) -> KPipeline:
        """
        Lazy-loads and caches phonetic pipelines for all 9 Kokoro languages:
        'a'=US English, 'b'=UK English, 'e'=Spanish, 'f'=French, 'h'=Hindi,
        'i'=Italian, 'j'=Japanese, 'p'=Portuguese, 'z'=Mandarin Chinese.
        """
        valid_codes = {'a', 'b', 'e', 'f', 'h', 'i', 'j', 'p', 'z'}
        
        # If unknown prefix (e.g., custom file without standard prefix), default to US English
        if lang_code not in valid_codes:
            lang_code = "a"
            
        if lang_code not in self.pipelines:
            print(f"[TTS] Loading new language pipeline for prefix '{lang_code}'...")
            self.pipelines[lang_code] = KPipeline(lang_code=lang_code)
            
        return self.pipelines[lang_code]

    def clean_text_for_tts(self, text: str) -> str:
        """
        Strips emojis, emoticons, flags, and pictographs from the text so Kokoro-TTS skips them
        without breaking multilingual alphabets (Mandarin, Japanese, Hindi, etc.) or punctuation.
        """
        if not text:
            return ""
            
        emoji_pattern = re.compile(
            r'['
            r'\U0001F600-\U0001F64F'  # Emoticons
            r'\U0001F300-\U0001F5FF'  # Symbols & Pictographs
            r'\U0001F680-\U0001F6FF'  # Transport & Map Symbols
            r'\U0001F1E0-\U0001F1FF'  # Flags
            r'\U00002702-\U000027B0'  # Dingbats
            r'\U000024C2-\U0001F251'  # Enclosed characters
            r'\U0001F900-\U0001F9FF'  # Supplemental Symbols & Pictographs
            r'\U0001FA70-\U0001FAFF'  # Symbols & Pictographs Extended-A
            r']+', 
            flags=re.UNICODE
        )
        # Replace emojis with a space, then strip extra whitespace
        return emoji_pattern.sub(' ', text).strip()

    def _resolve_voice_parameter(self, voice: str):
        """
        Determines whether the requested voice is a local .pt tensor file,
        a blended string, or a built-in preset.
        """
        custom_file_path = os.path.join(self.custom_voices_dir, f"{voice}.pt")
        if os.path.exists(custom_file_path):
            print(f"[TTS] Using custom cloned voice tensor: {custom_file_path}")
            return torch.load(custom_file_path, weights_only=True)
        return voice

    def synthesize_to_bytes(self, text: str, voice: str = "af_heart", speed: float = 1.0) -> bytes:
        """
        Standard single-buffer synthesis. Generates WAV bytes for an entire string.
        """
        # 1. Strip emojis before doing any phonetic processing
        clean_text = self.clean_text_for_tts(text)
        if not clean_text:
            return b""  # Return empty bytes if the message consisted purely of emojis

        lang_prefix = voice[0].lower() if voice and len(voice) > 0 else "a"
        pipeline = self.get_pipeline(lang_prefix)
        voice_param = self._resolve_voice_parameter(voice)
            
        generator = pipeline(clean_text, voice=voice_param, speed=speed)
        
        out_buffer = io.BytesIO()
        for _, _, audio_data in generator:
            if audio_data is not None:
                sf.write(out_buffer, audio_data, 24000, format='WAV')
            break  # Grab the first chunk
            
        out_buffer.seek(0)
        return out_buffer.read()

    def synthesize_stream(self, text: str, voice: str = "af_heart", speed: float = 1.0):
        """
        Yields tuples of (sentence_text, wav_bytes) sequentially.
        This enables synchronized real-time text reveal with audio playback on the frontend!
        """
        # 1. Strip emojis before doing any phonetic processing
        clean_text = self.clean_text_for_tts(text)
        if not clean_text:
            return  # Exit the generator immediately if the text was only emojis

        lang_prefix = voice[0].lower() if voice and len(voice) > 0 else "a"
        pipeline = self.get_pipeline(lang_prefix)
        voice_param = self._resolve_voice_parameter(voice)
            
        # Kokoro automatically splits long clean text into natural clauses and sentences
        generator = pipeline(clean_text, voice=voice_param, speed=speed)
        
        for graphemes, phonemes, audio_data in generator:
            if not graphemes or audio_data is None:
                continue
                
            out_buffer = io.BytesIO()
            sf.write(out_buffer, audio_data, 24000, format='WAV')
            out_buffer.seek(0)
            
            # Yield exact sentence text paired with its generated audio bytes
            yield graphemes, out_buffer.read()