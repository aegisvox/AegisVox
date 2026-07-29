import json
from typing import Any, Dict, Optional


def extract_tool_call(text: str) -> Optional[Dict[str, Any]]:
    """Extracts the first run_script tool call from model output.

    Supports inline JSON, fenced code blocks, and surrounding prose.
    """
    if not text:
        return None

    start = None
    depth = 0
    in_string = False
    escape = False

    for index, char in enumerate(text):
        if in_string:
            if escape:
                escape = False
            elif char == "\\":
                escape = True
            elif char == '"':
                in_string = False
            continue

        if char == '"':
            in_string = True
        elif char == "{":
            if depth == 0:
                start = index
            depth += 1
        elif char == "}":
            if depth > 0:
                depth -= 1
                if depth == 0 and start is not None:
                    candidate = text[start : index + 1]
                    try:
                        parsed = json.loads(candidate)
                    except json.JSONDecodeError:
                        start = None
                        continue

                    if isinstance(parsed, dict) and parsed.get("tool_call") == "run_script":
                        return parsed
                    start = None

    return None
