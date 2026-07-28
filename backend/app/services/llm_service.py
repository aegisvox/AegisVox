from pathlib import Path
import litert_lm
from backend.app.services.model_manager import LLM_DIR, download_file_with_progress

class LLMService:
    def __init__(self, model_filename: str = "gemma-4-E2B-it.litertlm"):
        model_path = LLM_DIR / model_filename
        
        # Self-healing fallback if the model file was removed or missing
        if not model_path.exists():
            print("⚠️ [LLM] Model file missing at runtime. Executing emergency download...")
            url = "https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it.litertlm"
            download_file_with_progress(url, model_path, "Gemma LiteRT")

        print(f"🧠 [LLM] Loading Gemma via LiteRT-LM from {model_path}...")
        try:
            self.engine = litert_lm.Engine(str(model_path), backend=litert_lm.Backend.CPU())
            self.system_prompt = litert_lm.Message.system(
                "You are GemmaLive, an intelligent, local-first AI assistant. Keep your responses concise, natural, and friendly."
            )
            self.ready = True
            print("🟢 [LLM] Gemma engine online!")
        except Exception as e:
            print(f"❌ [LLM] Failed to initialize LiteRT engine: {e}")
            self.ready = False

    def generate_response(self, user_prompt: str) -> str:
        """Generates a conversational response from the locally loaded Gemma model."""
        if not self.ready:
            return f"I heard: '{user_prompt}', but my local LLM engine failed to initialize."
            
        messages = [self.system_prompt, litert_lm.Message.user(user_prompt)]
        full_reply = ""
        
        with self.engine.create_conversation(messages=messages) as conversation:
            for chunk in conversation.send_message_async(user_prompt):
                text_token = chunk["content"][0]["text"]
                if text_token:
                    full_reply += text_token
                    
        return full_reply.strip()