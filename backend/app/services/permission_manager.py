import hashlib
import json
import os
import uuid
from typing import Any, Dict, Optional


class PermissionManager:
    def __init__(self, config_path: str):
        self.config_path = os.path.abspath(config_path)
        self.config: Dict[str, Any] = {
            "device_verification_code": "",
            "grants": {}
        }
        self._load_config()

    def _load_config(self) -> None:
        directory = os.path.dirname(self.config_path)
        if directory and not os.path.exists(directory):
            os.makedirs(directory, exist_ok=True)

        if os.path.exists(self.config_path):
            try:
                with open(self.config_path, "r", encoding="utf-8") as f:
                    self.config = json.load(f)
            except Exception:
                self.config = {
                    "device_verification_code": "",
                    "grants": {}
                }

        if not self.config.get("device_verification_code"):
            self.config["device_verification_code"] = str(uuid.uuid4())
            self._save_config()

        if "grants" not in self.config or not isinstance(self.config["grants"], dict):
            self.config["grants"] = {}
            self._save_config()

    def _save_config(self) -> None:
        with open(self.config_path, "w", encoding="utf-8") as f:
            json.dump(self.config, f, indent=2)

    def get_device_verification_code(self) -> str:
        return self.config["device_verification_code"]

    def _expected_token(self, skill_name: str, permission: str) -> str:
        device_code = self.get_device_verification_code()
        payload = f"{device_code}:{skill_name}:{permission}"
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()

    def grant_permission(self, skill_name: str, permission: str, verification_code: str) -> Optional[str]:
        if verification_code != self.get_device_verification_code():
            return None

        token = self._expected_token(skill_name, permission)
        grants = self.config.setdefault("grants", {})
        skill_grants = grants.setdefault(skill_name, {})
        skill_grants[permission] = token
        self._save_config()
        return token

    def is_permission_granted(self, skill_name: str, permission: str, token: str) -> bool:
        if not token:
            return False

        grants = self.config.get("grants", {})
        skill_grants = grants.get(skill_name, {})
        return skill_grants.get(permission) == token

    def get_grant_token(self, skill_name: str, permission: str) -> Optional[str]:
        grants = self.config.get("grants", {})
        return grants.get(skill_name, {}).get(permission)
