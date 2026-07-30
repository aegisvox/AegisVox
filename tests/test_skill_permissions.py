import json

from backend.app.services.skill_manager import SkillManager


def test_skill_manager_loads_manifest_permissions_and_permission_metadata(tmp_path):
    skills_dir = tmp_path / "skills"
    skill_dir = skills_dir / "example"
    skill_dir.mkdir(parents=True)

    (skill_dir / "SKILL.md").write_text(
        "---\nname: example\ndescription: Example skill\n---\nUse it.\n",
        encoding="utf-8",
    )
    (skill_dir / "manifest.json").write_text(
        json.dumps({"permissions": ["app.display.showDataOnCanvas"]}),
        encoding="utf-8",
    )

    permissions_path = tmp_path / "permissions.json"
    permissions_path.write_text(
        json.dumps(
            {
                "app.display.showDataOnCanvas": {
                    "authorizationRequired": True,
                    "authorizationMessage": "Allow display on canvas?",
                }
            }
        ),
        encoding="utf-8",
    )

    manager = SkillManager(skills_dir=str(skills_dir), permissions_path=str(permissions_path))
    skill = manager.skills["example"]

    assert skill.permissions == ["app.display.showDataOnCanvas"]
    assert skill.permission_definitions["app.display.showDataOnCanvas"]["authorizationRequired"] is True
