from pathlib import Path
from typing import Callable, Optional

import litert_lm
from backend.app.services.model_manager import LLM_DIR

class LLMService:
    def __init__(self, model_filename: str = "gemma-4-E2B-it.litertlm"):
        self.model_filename = model_filename
        self.model_path = LLM_DIR / model_filename
        self.engine = None
        self.system_prompt = litert_lm.Message.system(
            "You are AegisVox, an intelligent, local-first AI assistant. Keep your responses concise, natural, and friendly."
        )
        self.ready = False
        self._load_engine()

    def _load_engine(self) -> None:
        if not self.model_path.exists():
            self.ready = False
            return

        print(f"🧠 [LLM] Loading Gemma via LiteRT-LM from {self.model_path}...")
        try:
            self.engine = litert_lm.Engine(str(self.model_path), backend=litert_lm.Backend.CPU())
            self.ready = True
            print("🟢 [LLM] Gemma engine online!")
        except Exception as e:
            print(f"❌ [LLM] Failed to initialize LiteRT engine: {e}")
            self.ready = False

    def ensure_ready(self) -> bool:
        if self.ready:
            return True
        self._load_engine()
        return self.ready

    def reload_engine(self) -> None:
        self._load_engine()

    def generate_response(self, user_prompt: str, on_text: Optional[Callable[[str], None]] = None) -> str:
        """Generates a conversational response from the locally loaded Gemma model."""
        if not self.ensure_ready():
            return (
                f"I heard: '{user_prompt}', but the local LLM model is not installed yet. "
                "Please install the local models from the UI."
            )

        full_reply = ""
        for text_chunk in self.stream_response(user_prompt, on_text=on_text):
            full_reply += text_chunk
        return full_reply.strip()

    def generate_stream(self, user_prompt: str, on_text: Optional[Callable[[str], None]] = None):
        """Yields streaming text chunks for real-time consumption.

        Example usage:
            for chunk in llm_service.generate_stream("Tell me a long story."):
                print(chunk, end="", flush=True)
        """
        if not self.ensure_ready():
            yield (
                f"I heard: '{user_prompt}', but the local LLM model is not installed yet. "
                "Please install the local models from the UI."
            )
            return

        # Delegate to the lower-level stream_response generator (real-time)
        for text in self.stream_response(user_prompt, on_text=on_text):
            yield text

    def stream_response(self, user_prompt: str, on_text: Optional[Callable[[str], None]] = None):
        """Yields streaming text chunks from the locally loaded Gemma model."""
        if not self.ensure_ready():
            yield (
                f"I heard: '{user_prompt}', but the local LLM model is not installed yet. "
                "Please install the local models from the UI."
            )
            return

        messages = [self.system_prompt, litert_lm.Message.user(user_prompt)]
        with self.engine.create_conversation(messages=messages) as conversation:
            for chunk in conversation.send_message_async(
                user_prompt,
                thinking_config=litert_lm.ThinkingConfig(
                    enable_thinking=True,
                    thinking_token_budget=256
                )
            ):
                for item in chunk.get("content", []):
                    if item.get("type") == "text":
                        text = item.get("text")
                        if text:
                            if on_text:
                                print(text)
                                on_text(text)
                            yield text
