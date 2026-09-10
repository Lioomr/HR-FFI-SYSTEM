"""Download the PaddleOCR models the employee document pilot needs.

Run this once with network access - during the Docker image build, or against a
mounted model volume. Afterwards the OCR worker resolves the models from
`EMPLOYEE_DOCUMENT_OCR_MODEL_DIR` and never needs the internet.

    python manage.py provision_ocr_models
    python manage.py provision_ocr_models --model-dir /srv/paddleocr --verify
"""

from __future__ import annotations

import os
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from employees.ocr import engine


class Command(BaseCommand):
    help = "Download and verify the PaddleOCR detection/recognition/angle models used for employee documents."

    def add_arguments(self, parser):
        parser.add_argument(
            "--model-dir",
            default="",
            help="Target model root. Defaults to settings.EMPLOYEE_DOCUMENT_OCR_MODEL_DIR.",
        )
        parser.add_argument(
            "--languages",
            default=",".join(engine.SUPPORTED_LANGUAGES),
            help="Comma-separated language packs to provision (default: %(default)s).",
        )
        parser.add_argument(
            "--verify",
            action="store_true",
            help="Only check that the models are already present; download nothing.",
        )

    def handle(self, *args, **options):
        model_dir = Path(options["model_dir"] or engine.model_root()).expanduser()
        languages = [item.strip() for item in options["languages"].split(",") if item.strip()]
        model_dir.mkdir(parents=True, exist_ok=True)

        if options["verify"]:
            return self._verify(model_dir, languages)

        # PaddleOCR 2.x caches downloads under $HOME/.paddleocr; pointing HOME at
        # the managed directory is what makes the cache reproducible and portable.
        previous_home = os.environ.get("HOME")
        previous_userprofile = os.environ.get("USERPROFILE")
        os.environ["HOME"] = str(model_dir)
        os.environ["USERPROFILE"] = str(model_dir)
        os.environ.setdefault("PADDLE_PDX_CACHE_HOME", str(model_dir))
        engine.reset_engine_cache()
        try:
            from paddleocr import PaddleOCR
        except Exception as exc:  # pragma: no cover - depends on the image
            raise CommandError("PaddleOCR is not installed in this environment.") from exc

        try:
            for language in languages:
                self.stdout.write(f"Provisioning PaddleOCR models for '{language}' in {model_dir} ...")
                try:
                    PaddleOCR(lang=language, use_angle_cls=True, show_log=False, use_gpu=False)
                except TypeError:
                    PaddleOCR(lang=language)
                except Exception as exc:
                    raise CommandError(f"Could not provision models for '{language}': {exc}") from exc
        finally:
            self._restore("HOME", previous_home)
            self._restore("USERPROFILE", previous_userprofile)
            engine.reset_engine_cache()

        return self._verify(model_dir, languages)

    @staticmethod
    def _restore(name: str, value: str | None) -> None:
        if value is None:
            os.environ.pop(name, None)
        else:
            os.environ[name] = value

    def _verify(self, model_dir: Path, languages: list[str]):
        missing = []
        for language in languages:
            dirs = engine.discover_model_dirs(language, root=model_dir)
            if not dirs.get("rec_model_dir") or not dirs.get("det_model_dir"):
                missing.append(language)
                self.stderr.write(f"  {language}: models NOT found under {model_dir}")
                continue
            for kind, path in sorted(dirs.items()):
                self.stdout.write(f"  {language} {kind}: {path}")
        if missing:
            raise CommandError(f"OCR models are missing for: {', '.join(missing)}")
        self.stdout.write(self.style.SUCCESS(f"PaddleOCR models are provisioned in {model_dir}"))
