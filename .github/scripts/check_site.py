"""Sanity checks for the published site; stdlib only.

1. Every JSON file parses, and data.json lists at least one experiment (an empty export
   once blanked the live site).
2. Every local file an HTML page references exists.
3. No WRDS security identifiers appear in published data (aggregates only).
"""

import json
import re
import sys
from pathlib import Path

ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
FORBIDDEN_KEYS = {"permno", "permco", "gvkey", "cusip", "ncusip", "iid"}
REF = re.compile(r'(?:src|href)="([^"]+)"')

errors = []


def walk_keys(obj, path):
    if isinstance(obj, dict):
        for key, value in obj.items():
            if key.lower() in FORBIDDEN_KEYS:
                errors.append(f"{path}.{key}: security identifier in published data")
            walk_keys(value, f"{path}.{key}")
    elif isinstance(obj, list):
        for i, value in enumerate(obj):
            walk_keys(value, f"{path}[{i}]")


for path in sorted(ROOT.glob("*.json")):
    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError as e:
        errors.append(f"{path.name}: invalid JSON ({e})")
        continue
    walk_keys(data, path.name)
    if path.name == "data.json" and not data.get("experiments"):
        errors.append("data.json: no experiments (refusing to publish a blank site)")

if not (ROOT / "data.json").exists():
    errors.append("data.json: missing")

for page in sorted(ROOT.glob("*.html")):
    for ref in REF.findall(page.read_text()):
        if re.match(r"^(https?:|data:|mailto:|#)", ref):
            continue
        target = ref.split("#")[0].split("?")[0]
        if target and not (ROOT / target).exists():
            errors.append(f"{page.name}: references missing file {target}")

if errors:
    print("\n".join(errors))
    sys.exit(1)
print(f"ok: {len(list(ROOT.glob('*.html')))} pages, {len(list(ROOT.glob('*.json')))} data files")
