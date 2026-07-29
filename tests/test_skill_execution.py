from backend.app.services.tool_call_parser import extract_tool_call


def test_extract_tool_call_from_code_fence():
    text = '''The assistant should run this tool:
```json
{"tool_call": "run_script", "skill": "system_info", "script": "index.py", "data": {"target": "cpu"}}
```
'''

    assert extract_tool_call(text) == {
        "tool_call": "run_script",
        "skill": "system_info",
        "script": "index.py",
        "data": {"target": "cpu"},
    }


def test_extract_tool_call_from_inline_json():
    text = 'I will execute {"tool_call": "run_script", "skill": "system_info", "script": "index.py", "data": {"target": "memory"}} now.'

    assert extract_tool_call(text) == {
        "tool_call": "run_script",
        "skill": "system_info",
        "script": "index.py",
        "data": {"target": "memory"},
    }
