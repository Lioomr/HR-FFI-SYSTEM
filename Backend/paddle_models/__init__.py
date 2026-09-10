"""Django-free PaddleOCR model provisioning and layout discovery.

This package is deliberately importable without Django so the Docker image can
download the models in a layer that does not depend on application code - the
expensive model layer stays cached when only Python source changes.

Build usage:
    python -m paddle_models --model-dir /opt/paddleocr
    python -m paddle_models --model-dir /opt/paddleocr --verify
"""

from __future__ import annotations

import os
from pathlib import Path

# Language packs the pilot provisions. "ar" recognises Arabic script; "en" is the
# sharper model for Latin text and digits, which Saudi cards print alongside it.
SUPPORTED_LANGUAGES = ("en", "ar")

MODEL_WEIGHT_FILES = ("inference.pdmodel", "inference.json", "inference.pdiparams")

# Tokens that identify which language a discovered model directory serves.
LANGUAGE_TOKENS = {
    "ar": ("arabic", "multilingual"),
    "en": ("en_pp", "/en_", "english", "ch_pp"),
}


def is_model_dir(path: Path) -> bool:
    return path.is_dir() and any((path / name).exists() for name in MODEL_WEIGHT_FILES)


def discover_model_dirs(language: str, root: Path | str) -> dict[str, str]:
    """Map PaddleOCR model kinds to provisioned directories under `root`.

    PaddleOCR lays its cache out as `<root>/.paddleocr/whl/<kind>/<name>/<version>/`
    and the exact directory names move between releases, so the tree is scanned
    for weight files rather than hard-coding paths or download URLs.
    """

    base = Path(root)
    if not base.is_dir():
        return {}

    found: dict[str, list[Path]] = {"det": [], "rec": [], "cls": []}
    for candidate in base.rglob("*"):
        if not is_model_dir(candidate):
            continue
        parts = [part.lower() for part in candidate.parts]
        for kind in found:
            if kind in parts:
                found[kind].append(candidate)
                break

    def pick(kind: str, *preferred: str) -> str:
        candidates = sorted(found.get(kind) or [])
        if not candidates:
            return ""
        for token in preferred:
            for candidate in candidates:
                if token in str(candidate).replace(os.sep, "/").lower():
                    return str(candidate)
        return "" if preferred else str(candidates[0])

    tokens = LANGUAGE_TOKENS.get(language, (language,))
    dirs = {
        "det_model_dir": pick("det", *tokens) or pick("det"),
        "rec_model_dir": pick("rec", *tokens),
        "cls_model_dir": pick("cls"),
    }
    return {key: value for key, value in dirs.items() if value}


def verify(root: Path | str, languages=SUPPORTED_LANGUAGES) -> dict[str, dict[str, str]]:
    """Return the resolved directories per language; empty dict means missing."""

    return {language: discover_model_dirs(language, root) for language in languages}


def provision(root: Path | str, languages=SUPPORTED_LANGUAGES) -> dict[str, dict[str, str]]:
    """Download the models for each language into `root`.

    PaddleOCR 2.x caches downloads under `$HOME/.paddleocr`, so HOME is pointed at
    the managed directory for the duration of the download. This is the only step
    that needs network access; the worker never repeats it.
    """

    target = Path(root)
    target.mkdir(parents=True, exist_ok=True)

    previous = {name: os.environ.get(name) for name in ("HOME", "USERPROFILE", "PADDLE_PDX_CACHE_HOME")}
    os.environ["HOME"] = str(target)
    os.environ["USERPROFILE"] = str(target)
    os.environ["PADDLE_PDX_CACHE_HOME"] = str(target)
    try:
        from paddleocr import PaddleOCR

        for language in languages:
            try:
                PaddleOCR(lang=language, use_angle_cls=True, show_log=False, use_gpu=False)
            except TypeError:
                PaddleOCR(lang=language)
    finally:
        for name, value in previous.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value

    return verify(target, languages)


def _main(argv=None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description="Provision PaddleOCR models into a managed directory.")
    parser.add_argument("--model-dir", required=True)
    parser.add_argument("--languages", default=",".join(SUPPORTED_LANGUAGES))
    parser.add_argument("--verify", action="store_true", help="Check only; download nothing.")
    options = parser.parse_args(argv)

    languages = [item.strip() for item in options.languages.split(",") if item.strip()]
    resolved = verify(options.model_dir, languages) if options.verify else provision(options.model_dir, languages)

    missing = []
    for language, dirs in resolved.items():
        if not dirs.get("rec_model_dir") or not dirs.get("det_model_dir"):
            missing.append(language)
            print(f"  {language}: models NOT found under {options.model_dir}")
            continue
        for kind, path in sorted(dirs.items()):
            print(f"  {language} {kind}: {path}")
    if missing:
        print(f"OCR models are missing for: {', '.join(missing)}")
        return 1
    print(f"PaddleOCR models are provisioned in {options.model_dir}")
    return 0


if __name__ == "__main__":  # pragma: no cover - build-time entry point
    raise SystemExit(_main())
