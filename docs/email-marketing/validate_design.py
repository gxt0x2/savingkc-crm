"""Validate the design package; never contacts a provider or tests application code."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
errors = []
manifest = json.loads((ROOT / "design-manifest.json").read_text())
tasks = {t["id"]: t for t in manifest["tasks"]}
if len(tasks) != len(manifest["tasks"]):
    errors.append("Duplicate task IDs")
visiting, visited = set(), set()

def visit(task_id):
    if task_id in visiting:
        errors.append(f"Dependency cycle at {task_id}")
        return
    if task_id in visited:
        return
    if task_id not in tasks:
        errors.append(f"Missing dependency {task_id}")
        return
    visiting.add(task_id)
    for dep in tasks[task_id]["dependencies"]:
        visit(dep)
    visiting.remove(task_id)
    visited.add(task_id)

for task_id in tasks:
    visit(task_id)
    if not (ROOT / "tasks" / f"{task_id}.md").is_file():
        errors.append(f"Missing packet {task_id}")

pages_text = (ROOT / "04-pages-and-interactions.md").read_text()
page_ids = set(re.findall(r"^\| (P\d{2}) \|", pages_text, re.M))
actions = set(re.findall(r"^\| ([A-Z]{2,3}-[A-Z-]+) ·", pages_text, re.M))
actions |= {"UI-VIEW", "UI-CANCEL", "UI-DOWNLOAD"}
owned = {a for t in tasks.values() for a in t["actions"]}
for action in sorted(actions - owned):
    errors.append(f"Action without packet owner: {action}")
for action in sorted(owned - actions):
    errors.append(f"Packet refers to undefined action: {action}")

test_text = (ROOT / "06-tests-and-release.md").read_text()
test_ids = set(re.findall(r"^\| (T\d{2}) \|", test_text, re.M))
owned_tests = {x for t in tasks.values() for x in t["tests"]}
for test in sorted(test_ids - owned_tests):
    errors.append(f"Test without packet: {test}")
for test in sorted(owned_tests - test_ids):
    errors.append(f"Undefined test in packet: {test}")
for row in pages_text.splitlines():
    if re.match(r"\| [A-Z]{2,3}-[A-Z-]+ ·", row):
        refs = set(re.findall(r"T\d{2}", row))
        if not refs or refs - test_ids:
            errors.append(f"Action has invalid acceptance references: {row.split('|')[1].strip()}")

for file in ROOT.rglob("*.md"):
    for link in re.findall(r"\[[^\]]+\]\(([^)]+)\)", file.read_text()):
        target = link.split("#", 1)[0]
        if not target or re.match(r"[a-z]+://", target) or target.startswith("/"):
            continue
        if not (file.parent / target).exists():
            errors.append(f"Broken link in {file.relative_to(ROOT)}: {target}")

fixtures = json.loads((ROOT / "ai-fixtures.json").read_text())["cases"]
fixture_ids = [f["id"] for f in fixtures]
if len(set(fixture_ids)) != len(fixture_ids):
    errors.append("Duplicate AI fixture IDs")
for case in fixtures:
    if not all(k in case for k in ("text", "context", "intent", "action", "critical", "forbidden")):
        errors.append(f"Incomplete AI fixture {case.get('id')}")
    if not case.get("forbidden"):
        errors.append(f"Missing prohibited effects {case.get('id')}")
if page_ids != {f"P{i:02}" for i in range(1, 20)}:
    errors.append("Page inventory is incomplete")
if test_ids != {f"T{i:02}" for i in range(1, 63)}:
    errors.append("Acceptance inventory is incomplete")

result = {
    "date": "2026-09-12",
    "scope": "Design references and coverage only; no application/provider verification",
    "passed": not errors,
    "pages": len(page_ids), "actions": len(actions), "packets": len(tasks),
    "acceptance_cases": len(test_ids), "ai_seed_cases": len(fixtures),
    "errors": errors,
}
(ROOT / "design-validation.json").write_text(json.dumps(result, indent=2) + "\n")
print(json.dumps(result, indent=2))
raise SystemExit(1 if errors else 0)
