import os
import importlib
import platform
from pathlib import Path
from typing import Callable, Optional

import litert_lm
from backend.app.services.model_manager import LLM_DIR

class LLMService:
    def __init__(self, model_filename: str = "gemma-4-E2B-it.litertlm"):
        self.model_filename = model_filename
        self.model_path = LLM_DIR / model_filename
        self.engine = None
        self.backend = None
        self.system_prompt = litert_lm.Message.system(
            "You are AegisVox, an intelligent, local-first AI assistant. Keep your responses concise, natural, and friendly."
        )
        self.ready = False
        self._load_engine()

    def _get_backend(self):
        backend_name = os.environ.get("LLM_BACKEND", "auto").strip().lower()

        if backend_name == "auto":
            backend_name = self._detect_backend()

        if backend_name == "gpu":
            return litert_lm.Backend.GPU()
        if backend_name == "npu":
            for backend_name_candidate in ("openvino", "qnn", "directml"):
                backend = self._try_named_backend(backend_name_candidate)
                if backend is not None:
                    return backend
        return litert_lm.Backend.CPU()

    def _detect_backend(self) -> str:
        checks = self._hardware_check_results()

        if checks["gpu"]:
            return "gpu"
        if checks["npu"]:
            return "npu"
        return "cpu"

    def _hardware_check_results(self) -> dict[str, bool]:
        return {
            "cpu": self._check_cpu(),
            "gpu": self._check_gpu(),
            "npu": self._check_npu(),
        }

    def _check_cpu(self) -> bool:
        return bool(os.cpu_count())

    def _check_gpu(self) -> bool:
        gpu_detected = False

        try:
            torch = importlib.import_module("torch")

            if torch.cuda.is_available():
                gpu_detected = True
            elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
                gpu_detected = True
        except ImportError:
            pass

        try:
            tf = importlib.import_module("tensorflow")

            if tf.config.list_physical_devices("GPU"):
                gpu_detected = True
        except ImportError:
            pass

        return gpu_detected

    def _check_npu(self) -> bool:
        npu_found = False

        try:
            ort = importlib.import_module("onnxruntime")

            providers = ort.get_available_providers()
            npu_backends = {
                "QNNExecutionProvider": "Qualcomm Hexagon NPU",
                "OpenVINOExecutionProvider": "Intel NPU / Accelerator",
                "CoreMLExecutionProvider": "Apple Neural Engine (ANE)",
                "DirectMLExecutionProvider": "Windows DirectML (NPU/GPU)",
                "VitisAIExecutionProvider": "AMD Ryzen AI / Xilinx NPU",
            }

            active_npus = [name for prov, name in npu_backends.items() if prov in providers]
            if active_npus:
                npu_found = True
        except ImportError:
            pass

        try:
            openvino_runtime = importlib.import_module("openvino.runtime")
            Core = getattr(openvino_runtime, "Core", None)
            if Core is None:
                return npu_found

            core = Core()
            devices = core.available_devices
            if any("NPU" in device.upper() for device in devices):
                npu_found = True
        except ImportError:
            pass

        return npu_found

    def _try_named_backend(self, backend_name: str):
        backend_lookup = {
            "openvino": ("OpenVINO", "OpenVINOBackend"),
            "qnn": ("QNN", "QNNBackend"),
            "directml": ("DirectML", "DirectMLBackend"),
        }

        candidates = backend_lookup.get(backend_name, ())
        for candidate in candidates:
            backend_factory = getattr(litert_lm.Backend, candidate, None)
            if backend_factory is None:
                continue
            try:
                return backend_factory()
            except Exception:
                continue
        return None

    def _should_enable_thinking(self) -> bool:
        return os.environ.get("LLM_ENABLE_THINKING", "false").strip().lower() in {"1", "true", "yes", "on"}

    def _load_engine(self) -> None:
        if not self.model_path.exists():
            self.ready = False
            return

        print(f"🧠 [LLM] Loading Gemma via LiteRT-LM from {self.model_path}...")
        try:
            self.backend = self._get_backend()
            print(f"🖥️ [LLM] Using backend: {type(self.backend).__name__}")
            self.engine = litert_lm.Engine(str(self.model_path), backend=self.backend)
            self.ready = True
            print("🟢 [LLM] Gemma engine online!")
        except Exception as e:
            if self.backend is not None and "gpu" in type(self.backend).__name__.lower():
                try:
                    print(f"⚠️ [LLM] GPU backend init failed, retrying on CPU: {e}")
                    self.backend = litert_lm.Backend.CPU()
                    self.engine = litert_lm.Engine(str(self.model_path), backend=self.backend)
                    self.ready = True
                    print("🟢 [LLM] Gemma engine online on CPU!")
                    return
                except Exception as cpu_error:
                    print(f"❌ [LLM] Failed to initialize LiteRT engine: {cpu_error}")
            else:
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

        thinking_budget = int(os.environ.get("LLM_THINKING_TOKEN_BUDGET", "64"))
        messages = [self.system_prompt, litert_lm.Message.user(user_prompt)]
        attempts = [self._should_enable_thinking(), False]

        for enable_thinking in attempts:
            try:
                with self.engine.create_conversation(messages=messages) as conversation:
                    send_kwargs = {}
                    if enable_thinking:
                        send_kwargs["thinking_config"] = litert_lm.ThinkingConfig(
                            enable_thinking=True,
                            thinking_token_budget=thinking_budget,
                        )

                    for chunk in conversation.send_message_async(user_prompt, **send_kwargs):
                        for item in chunk.get("content", []):
                            if item.get("type") == "text":
                                text = item.get("text")
                                if text:
                                    if on_text:
                                        print(text)
                                        on_text(text)
                                    yield text
                return
            except Exception as exc:
                mode = "thinking" if enable_thinking else "standard"
                print(f"❌ [LLM] Stream failed in {mode} mode: {exc}")
                if enable_thinking:
                    print("⚠️ [LLM] Retrying once without thinking.")
                    continue
                yield "I’m having trouble generating a response right now. Please try again."
                return
