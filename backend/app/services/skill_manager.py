import json
import os
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

@dataclass
class Skill:
    name: str
    description: str
    instructions: str
    root_path: str
    manifest: Dict[str, Any] = field(default_factory=dict)
    permissions: List[str] = field(default_factory=list)
    permission_definitions: Dict[str, Dict[str, Any]] = field(default_factory=dict)

class SkillManager:
    def __init__(self, skills_dir: str = "backend/skills", permissions_path: Optional[str] = "backend/permissions.json"):
        self.skills_dir = skills_dir
        self.permissions_path = permissions_path
        self.permissions_catalog: Dict[str, Dict[str, Any]] = self._load_permissions_catalog()
        self.skills: Dict[str, Skill] = {}
        self.reload_skills()

    def _load_permissions_catalog(self) -> Dict[str, Dict[str, Any]]:
        if not self.permissions_path:
            return {}

        if not os.path.exists(self.permissions_path):
            return {}

        try:
            with open(self.permissions_path, "r", encoding="utf-8") as f:
                raw_data = json.load(f)
        except Exception as exc:
            print(f"[SkillManager] Failed to load permissions catalog: {exc}")
            return {}

        if not isinstance(raw_data, dict):
            return {}

        catalog: Dict[str, Dict[str, Any]] = {}
        for permission_name, metadata in raw_data.items():
            if isinstance(permission_name, str) and isinstance(metadata, dict):
                catalog[permission_name] = metadata
        return catalog

    def reload_skills(self):
        """Scans the backend/skills directory and loads all SKILL.md files."""
        self.skills.clear()
        if not os.path.exists(self.skills_dir):
            os.makedirs(self.skills_dir, exist_ok=True)
            return

        for folder in os.listdir(self.skills_dir):
            folder_path = os.path.join(self.skills_dir, folder)
            skill_md_path = os.path.join(folder_path, "SKILL.md")
            
            if os.path.isdir(folder_path) and os.path.exists(skill_md_path):
                skill = self._parse_skill_md(skill_md_path, folder_path)
                if skill:
                    self.skills[skill.name] = skill
        print(f"[SkillManager] Active skills ({len(self.skills)}): {list(self.skills.keys())}")

    def _parse_skill_md(self, file_path: str, root_path: str) -> Optional[Skill]:
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                content = f.read()

            frontmatter_match = re.match(r"^---\s*\n(.*?)\n---\s*\n(.*)$", content, re.DOTALL)
            if not frontmatter_match:
                return None

            raw_meta, body = frontmatter_match.groups()
            
            meta = {}
            for line in raw_meta.splitlines():
                if ":" in line:
                    key, val = line.split(":", 1)
                    meta[key.strip()] = val.strip().strip("'\"")

            manifest_data = {}
            permissions: List[str] = []
            manifest_path = os.path.join(root_path, "manifest.json")
            if os.path.exists(manifest_path):
                try:
                    with open(manifest_path, "r", encoding="utf-8") as mf:
                        manifest_data = json.load(mf)
                except Exception:
                    manifest_data = {}

            raw_permissions: List[str] = []
            display_data = manifest_data.get("display")
            if isinstance(display_data, dict):
                raw_permissions = display_data.get("permissions", [])

            manifest_permissions = manifest_data.get("permissions", [])
            if isinstance(manifest_permissions, str):
                manifest_permissions = [manifest_permissions]
            elif not isinstance(manifest_permissions, list):
                manifest_permissions = []

            combined_permissions = []
            for permission in [*raw_permissions, *manifest_permissions]:
                if isinstance(permission, str) and permission not in combined_permissions:
                    combined_permissions.append(permission)

            permission_definitions = {
                permission: self.permissions_catalog.get(permission, {})
                for permission in combined_permissions
                if permission in self.permissions_catalog
            }

            return Skill(
                name=meta.get("name", os.path.basename(root_path)),
                description=meta.get("description", "No description provided."),
                instructions=body.strip(),
                root_path=root_path,
                manifest=manifest_data,
                permissions=combined_permissions,
                permission_definitions=permission_definitions,
            )
        except Exception as e:
            print(f"[SkillManager] Failed to load {file_path}: {e}")
            return None

    def get_system_prompt_injection(self) -> str:
        """Returns the prompt extension containing all skill instructions."""
        if not self.skills:
            return ""
            
        prompt = "\n\n### EXTENDED AGENT SKILLS\n"
        prompt += "If the user request matches a skill, respond with a JSON execution block in this EXACT format:\n"
        prompt += '`{"tool_call": "run_script", "skill": "<skill_name>", "script": "<script_name>", "data": { ... }}`\n\n'
        
        for skill in self.skills.values():
            prompt += f"#### Skill: {skill.name}\n"
            prompt += f"Description: {skill.description}\n"
            prompt += f"Instructions:\n{skill.instructions}\n\n"
        return prompt