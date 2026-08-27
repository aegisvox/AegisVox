import os
import json
import subprocess
from typing import Dict, Any, Tuple
from .skill_manager import SkillManager

class AgentTools:
    def __init__(self, skill_manager: SkillManager):
        self.skill_manager = skill_manager

    def run_script(self, skill_name: str, script_name: str, data: Dict[str, Any]) -> Tuple[bool, str]:
        """
        Executes a target script from a skill directory and returns (success_boolean, output_string).
        """
        skill = self.skill_manager.skills.get(skill_name)
        if not skill:
            return False, f"Skill '{skill_name}' not found."

        safe_script_name = os.path.basename(script_name)
        scripts_dir = os.path.abspath(os.path.join(skill.root_path, "scripts"))
        script_path = os.path.abspath(os.path.join(scripts_dir, safe_script_name))

        if not script_path.startswith(scripts_dir + os.sep) and script_path != scripts_dir:
            return False, f"Access denied for script path outside of skill directory."

        if not os.path.exists(script_path):
            return False, f"Script '{safe_script_name}' not found inside {skill_name}."

        ext = os.path.splitext(script_name)[1].lower()
        interpreters = {".py": "python3", ".js": "node", ".sh": "bash"}
        interpreter = interpreters.get(ext)

        if not interpreter:
            return False, f"Unsupported script runtime '{ext}'."

        try:
            payload_str = json.dumps(data)
            process = subprocess.run(
                [interpreter, script_path, payload_str],
                capture_output=True,
                text=True,
                timeout=10
            )

            if process.returncode != 0:
                return False, process.stderr.strip() or "Script failed with non-zero exit code."

            return True, process.stdout.strip()

        except subprocess.TimeoutExpired:
            return False, "Script execution timed out (10s limit)."
        except Exception as e:
            return False, str(e)