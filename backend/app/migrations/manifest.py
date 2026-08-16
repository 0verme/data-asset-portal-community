from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

from .errors import ManifestError

SUPPORTED_DIALECTS = ("sqlite", "postgresql", "dws")


@dataclass(frozen=True)
class Migration:
    version: str
    name: str
    description: str
    files: dict[str, Path]
    transactional: bool
    baseline: bool = False
    modules: tuple[str, ...] = ("core",)

    def checksum(self, dialect: str) -> str:
        return hashlib.sha256(self.files[dialect].read_bytes()).hexdigest()


def load_manifest(root: Path) -> list[Migration]:
    path = root / "manifest.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ManifestError(f"cannot read migration manifest: {path}") from exc
    if set(data) != {"formatVersion", "migrations"} or data["formatVersion"] != 1 or not isinstance(data["migrations"], list):
        raise ManifestError("unsupported or invalid migration manifest format")
    migrations: list[Migration] = []
    used_files: set[Path] = set()
    previous = ""
    for item in data["migrations"]:
        required = {"version", "name", "description", "files", "transactional"}
        optional = {"baseline", "module", "modules"}
        if not isinstance(item, dict) or set(item) - (required | optional) or not required <= set(item):
            raise ManifestError("migration has unknown or missing fields")
        if "module" in item and "modules" in item:
            raise ManifestError("migration must declare module or modules, not both")
        version, name, files = item["version"], item["name"], item["files"]
        if not isinstance(version, str) or not version.isdigit() or len(version) != 4 or not isinstance(name, str) or not name:
            raise ManifestError("migration version or name is invalid")
        if version <= previous:
            raise ManifestError(f"migration versions must be unique and increasing: {version}")
        if (
            not isinstance(files, dict)
            or not files
            or not set(files) <= set(SUPPORTED_DIALECTS)
        ):
            raise ManifestError(f"migration {version} has invalid dialect files")
        paths: dict[str, Path] = {}
        for dialect, raw in files.items():
            if not isinstance(raw, str):
                raise ManifestError(f"migration {version} has invalid {dialect} file")
            candidate = (root / raw).resolve()
            try:
                candidate.relative_to(root.resolve())
            except ValueError as exc:
                raise ManifestError(f"migration {version} file escapes migration root") from exc
            if candidate in used_files or not candidate.is_file():
                raise ManifestError(f"migration {version} has missing or reused file: {raw}")
            used_files.add(candidate)
            paths[dialect] = candidate
        if not isinstance(item["transactional"], bool) or not isinstance(item["description"], str) or not isinstance(item.get("baseline", False), bool):
            raise ManifestError(f"migration {version} has invalid metadata")
        raw_modules = item.get("modules")
        if raw_modules is None:
            raw_modules = [item.get("module", "core")]
        if (
            not isinstance(raw_modules, list)
            or not raw_modules
            or any(not isinstance(module, str) or not module.strip() for module in raw_modules)
        ):
            raise ManifestError(f"migration {version} has invalid module ownership")
        migrations.append(
            Migration(
                version,
                name,
                item["description"],
                paths,
                item["transactional"],
                item.get("baseline", False),
                tuple(raw_modules),
            )
        )
        previous = version
    return migrations
