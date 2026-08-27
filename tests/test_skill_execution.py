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


def test_agent_tools_path_traversal_prevention(tmp_path):
    from backend.app.services.agent_tools import AgentTools
    from backend.app.services.skill_manager import SkillManager, Skill

    skills_dir = tmp_path / "skills"
    skill_dir = skills_dir / "test_skill"
    scripts_dir = skill_dir / "scripts"
    scripts_dir.mkdir(parents=True)

    (skill_dir / "SKILL.md").write_text("---\nname: test_skill\ndescription: Test\n---\n", encoding="utf-8")
    (scripts_dir / "valid.py").write_text("print('hello')", encoding="utf-8")

    skill_manager = SkillManager(skills_dir=str(skills_dir))
    agent_tools = AgentTools(skill_manager)

    # Test execution of valid script
    success, output = agent_tools.run_script("test_skill", "valid.py", {})
    assert success is True

    # Test path traversal attempts
    success, output = agent_tools.run_script("test_skill", "../../../etc/passwd", {})
    assert success is False
    assert "not found" in output or "Access denied" in output
