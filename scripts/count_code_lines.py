from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


EXCLUDED_DIR_NAMES = {
    "node_modules",
    "dist",
    "build",
    ".git",
    "__pycache__",
    ".venv",
    "venv",
    "env",
    "coverage",
    "logs",
    "target",
}

EXCLUDED_FILE_NAMES = {
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "bun.lockb",
    "poetry.lock",
    "Pipfile.lock",
    "Cargo.lock",
    "composer.lock",
}

EXCLUDED_EXTENSIONS = {
    ".7z",
    ".avi",
    ".bin",
    ".bmp",
    ".class",
    ".db",
    ".dll",
    ".dylib",
    ".eot",
    ".exe",
    ".gif",
    ".gz",
    ".ico",
    ".jar",
    ".jpeg",
    ".jpg",
    ".lock",
    ".min.js",
    ".min.css",
    ".mov",
    ".mp3",
    ".mp4",
    ".otf",
    ".pdf",
    ".png",
    ".pyc",
    ".pyd",
    ".pyo",
    ".rar",
    ".so",
    ".sqlite",
    ".sqlite3",
    ".svg",
    ".tar",
    ".ttf",
    ".wav",
    ".webm",
    ".webp",
    ".woff",
    ".woff2",
    ".zip",
}

TEXT_CODE_EXTENSIONS = {
    ".c",
    ".cc",
    ".cfg",
    ".conf",
    ".cpp",
    ".cs",
    ".css",
    ".env.example",
    ".go",
    ".h",
    ".hpp",
    ".html",
    ".ini",
    ".java",
    ".js",
    ".json",
    ".jsx",
    ".kt",
    ".less",
    ".lua",
    ".mjs",
    ".php",
    ".properties",
    ".ps1",
    ".py",
    ".rb",
    ".rs",
    ".sass",
    ".scss",
    ".sh",
    ".sql",
    ".toml",
    ".ts",
    ".tsx",
    ".txt",
    ".vue",
    ".xml",
    ".yaml",
    ".yml",
}

LINE_COMMENT_PREFIXES = {
    ".c": ("//",),
    ".cc": ("//",),
    ".conf": ("#", ";"),
    ".cfg": ("#", ";"),
    ".cpp": ("//",),
    ".cs": ("//",),
    ".css": (),
    ".go": ("//",),
    ".h": ("//",),
    ".hpp": ("//",),
    ".html": (),
    ".ini": (";", "#"),
    ".java": ("//",),
    ".js": ("//",),
    ".json": (),
    ".jsx": ("//",),
    ".kt": ("//",),
    ".less": ("//",),
    ".lua": ("--",),
    ".mjs": ("//",),
    ".php": ("//", "#"),
    ".properties": ("#", "!"),
    ".ps1": ("#",),
    ".py": ("#",),
    ".rb": ("#",),
    ".rs": ("//",),
    ".sass": ("//",),
    ".scss": ("//",),
    ".sh": ("#",),
    ".sql": ("--",),
    ".toml": ("#",),
    ".ts": ("//",),
    ".tsx": ("//",),
    ".txt": (),
    ".vue": ("//",),
    ".xml": (),
    ".yaml": ("#",),
    ".yml": ("#",),
}

BLOCK_COMMENT_MARKERS = {
    ".c": (("/*", "*/"),),
    ".cc": (("/*", "*/"),),
    ".cpp": (("/*", "*/"),),
    ".cs": (("/*", "*/"),),
    ".css": (("/*", "*/"),),
    ".go": (("/*", "*/"),),
    ".h": (("/*", "*/"),),
    ".hpp": (("/*", "*/"),),
    ".html": (("<!--", "-->"),),
    ".java": (("/*", "*/"),),
    ".js": (("/*", "*/"),),
    ".jsx": (("/*", "*/"),),
    ".kt": (("/*", "*/"),),
    ".less": (("/*", "*/"),),
    ".lua": (("--[[", "]]"),),
    ".mjs": (("/*", "*/"),),
    ".php": (("/*", "*/"),),
    ".rs": (("/*", "*/"),),
    ".sass": (("/*", "*/"),),
    ".scss": (("/*", "*/"),),
    ".sql": (("/*", "*/"),),
    ".ts": (("/*", "*/"),),
    ".tsx": (("/*", "*/"),),
    ".vue": (("/*", "*/"), ("<!--", "-->")),
    ".xml": (("<!--", "-->"),),
}

FRONTEND_HINTS = {
    "frontend",
    "web",
    "client",
    "ui",
    "portal",
    "page",
    "pages",
    "view",
    "views",
    "component",
    "components",
    "hook",
    "hooks",
    "style",
    "styles",
    "public",
    "vite",
}

BACKEND_HINTS = {
    "backend",
    "server",
    "api",
    "app",
    "service",
    "services",
    "controller",
    "controllers",
    "model",
    "models",
    "repository",
    "repositories",
    "dao",
    "db",
    "database",
    "migration",
    "migrations",
    "script",
    "scripts",
    "config",
    "configs",
}

FRONTEND_EXTENSIONS = {
    ".css",
    ".html",
    ".jsx",
    ".less",
    ".mjs",
    ".sass",
    ".scss",
    ".ts",
    ".tsx",
    ".vue",
}

BACKEND_EXTENSIONS = {
    ".go",
    ".java",
    ".kt",
    ".php",
    ".ps1",
    ".py",
    ".rb",
    ".sh",
    ".sql",
}


@dataclass
class FileStats:
    files: int = 0
    code: int = 0
    blank: int = 0
    comment: int = 0
    total: int = 0

    def add(self, other: "FileStats") -> None:
        self.files += other.files
        self.code += other.code
        self.blank += other.blank
        self.comment += other.comment
        self.total += other.total


def detect_suffix(path: Path) -> str:
    name = path.name.lower()
    if name.endswith(".min.js"):
        return ".min.js"
    if name.endswith(".min.css"):
        return ".min.css"
    if name.endswith(".env.example"):
        return ".env.example"
    suffixes = path.suffixes
    if not suffixes:
        return ""
    return suffixes[-1].lower()


def should_skip_dir(path: Path) -> bool:
    return any(part.lower() in EXCLUDED_DIR_NAMES for part in path.parts)


def should_skip_file(path: Path) -> bool:
    lower_name = path.name.lower()
    if lower_name in EXCLUDED_FILE_NAMES:
        return True

    suffix = detect_suffix(path)
    if suffix in EXCLUDED_EXTENSIONS:
        return True

    return False


def is_code_file(path: Path) -> bool:
    suffix = detect_suffix(path)
    return suffix in TEXT_CODE_EXTENSIONS


def classify_area(root: Path, file_path: Path) -> tuple[str | None, str]:
    relative_parts = [part.lower() for part in file_path.relative_to(root).parts]
    suffix = detect_suffix(file_path)

    if "frontend" in relative_parts:
        return "frontend", "matched explicit 'frontend' directory"
    if "backend" in relative_parts:
        return "backend", "matched explicit 'backend' directory"

    frontend_score = 0
    backend_score = 0

    if suffix in FRONTEND_EXTENSIONS:
        frontend_score += 2
    if suffix in BACKEND_EXTENSIONS:
        backend_score += 2

    for part in relative_parts[:-1]:
        if part in FRONTEND_HINTS:
            frontend_score += 2
        if part in BACKEND_HINTS:
            backend_score += 2

    filename = file_path.name.lower()
    if filename in {"package.json", "vite.config.js"}:
        frontend_score += 3
    if filename in {"requirements.txt", "pyproject.toml", "pom.xml"}:
        backend_score += 3

    if frontend_score > backend_score:
        return "frontend", f"heuristic classification: frontend score {frontend_score} > backend score {backend_score}"
    if backend_score > frontend_score:
        return "backend", f"heuristic classification: backend score {backend_score} > frontend score {frontend_score}"
    return None, "could not classify confidently"


def strip_inline_block_comments(text: str, markers: tuple[tuple[str, str], ...]) -> str:
    result = text
    for start, end in markers:
        while True:
            start_idx = result.find(start)
            if start_idx == -1:
                break
            end_idx = result.find(end, start_idx + len(start))
            if end_idx == -1:
                result = result[:start_idx]
                break
            result = result[:start_idx] + result[end_idx + len(end):]
    return result


def count_file(path: Path) -> FileStats:
    suffix = detect_suffix(path)
    line_comments = LINE_COMMENT_PREFIXES.get(suffix, ())
    block_markers = BLOCK_COMMENT_MARKERS.get(suffix, ())
    stats = FileStats(files=1)
    active_block: tuple[str, str] | None = None

    try:
        content = path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return FileStats()

    for raw_line in content.splitlines():
        stats.total += 1
        stripped = raw_line.strip()

        if not stripped:
            stats.blank += 1
            continue

        if active_block is not None:
            _, end_marker = active_block
            end_idx = stripped.find(end_marker)
            if end_idx == -1:
                stats.comment += 1
                continue

            trailing = stripped[end_idx + len(end_marker):].strip()
            if not trailing:
                stats.comment += 1
                active_block = None
                continue

            active_block = None
            stripped = trailing

        if any(stripped.startswith(prefix) for prefix in line_comments):
            stats.comment += 1
            continue

        block_only = False
        for start_marker, end_marker in block_markers:
            if stripped.startswith(start_marker):
                end_idx = stripped.find(end_marker, len(start_marker))
                if end_idx == -1:
                    trailing = stripped[len(start_marker):].strip()
                    if not trailing:
                        block_only = True
                    else:
                        block_only = False
                    active_block = (start_marker, end_marker)
                    break

                trailing = stripped[end_idx + len(end_marker):].strip()
                if not stripped[: stripped.find(start_marker)].strip() and not trailing:
                    block_only = True
                    break

                stripped = (stripped[: stripped.find(start_marker)] + " " + trailing).strip()
                break

        if block_only:
            stats.comment += 1
            continue

        cleaned = strip_inline_block_comments(stripped, block_markers).strip()
        if any(cleaned.startswith(prefix) for prefix in line_comments):
            stats.comment += 1
            continue

        if cleaned:
            stats.code += 1
        else:
            stats.comment += 1

    return stats


def iter_code_files(root: Path) -> Iterable[Path]:
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        if should_skip_dir(path.parent):
            continue
        if should_skip_file(path):
            continue
        if is_code_file(path):
            yield path


def format_wan(value: int) -> str:
    return f"{value / 10000:.2f}"


def main() -> None:
    parser = argparse.ArgumentParser(description="Count frontend/backend code lines in a project.")
    parser.add_argument("root", nargs="?", default=".", help="Project root path, default is current directory.")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    totals = {"frontend": FileStats(), "backend": FileStats()}
    classification_reasons: dict[str, set[str]] = {"frontend": set(), "backend": set()}
    unclassified: list[Path] = []

    for file_path in iter_code_files(root):
        area, reason = classify_area(root, file_path)
        if area is None:
            unclassified.append(file_path.relative_to(root))
            continue

        file_stats = count_file(file_path)
        totals[area].add(file_stats)
        classification_reasons[area].add(reason)

    overall = FileStats()
    overall.add(totals["frontend"])
    overall.add(totals["backend"])

    print("# Code Line Statistics")
    print()
    print(f"- Scan root: `{root}`")
    print(f"- Excluded directories: `{', '.join(sorted(EXCLUDED_DIR_NAMES))}`")
    print("- Excluded files: image/font/archive/database/lock/minified artifact files")
    print()
    print("| Area | Files | Effective Code Lines | Blank Lines | Comment Lines | Total Lines | Code (万行) |")
    print("| --- | ---: | ---: | ---: | ---: | ---: | ---: |")

    for area in ("frontend", "backend"):
        stats = totals[area]
        print(
            f"| {area} | {stats.files} | {stats.code} | {stats.blank} | "
            f"{stats.comment} | {stats.total} | {format_wan(stats.code)} |"
        )

    print(
        f"| total | {overall.files} | {overall.code} | {overall.blank} | "
        f"{overall.comment} | {overall.total} | {format_wan(overall.code)} |"
    )
    print()
    print("## Classification Notes")
    print()
    for area in ("frontend", "backend"):
        reasons = "；".join(sorted(classification_reasons[area])) if classification_reasons[area] else "no files classified"
        print(f"- {area}: {reasons}")

    if unclassified:
        print(
            f"- unclassified files: {len(unclassified)} file(s) not included because the script could not classify them confidently"
        )
        preview = ", ".join(str(path).replace("\\", "/") for path in unclassified[:10])
        if preview:
            print(f"- unclassified preview: `{preview}`")
    else:
        print("- unclassified files: none")


if __name__ == "__main__":
    main()
