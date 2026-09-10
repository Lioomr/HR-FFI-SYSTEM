# Employee Document OCR (self-hosted PaddleOCR)

Replaces the Tesseract path for Passport, Iqama, Saudi ID and Visa documents in
the employee archive. Runs only for new uploads and explicit HR re-runs - the
pilot never bulk-reprocesses archived documents.

## Modules

| File | Responsibility |
|---|---|
| `engine.py` | PaddleOCR loading, model-directory discovery, page rendering, result normalisation |
| `mrz.py` | ICAO 9303 TD3 machine readable zone parsing and check-digit validation |
| `parsers.py` | Per-document-type field extraction and validation rules |
| `pipeline.py` | Orchestration, status/warning decisions, persistence |

`employees/document_extraction.py` remains as a thin compatibility surface for
existing callers (`employees.tasks`, `employees.views`, `leaves.views`).

## Bilingual strategy

Non-passport documents run **two recognition passes** - English then Arabic - and
the results are merged by bounding box. This is deliberate: measured on the
synthetic fixtures inside the built image, the Arabic model reads Arabic script
well but splits Latin rows into word fragments and drops digit runs, so it alone
cannot deliver the `Label: value` lines the parsers validate. Passports skip the
Arabic pass entirely (a TD3 MRZ is Latin-only).

Merge rules (`pipeline.merge_bilingual_lines`):

- Two boxes are the same region only when they contain each other in **both**
  directions. A fragment merely sitting inside a wider line is kept alongside it -
  dropping the wider line to keep a fragment silently loses the digits only the
  wider line captured.
- For a genuine duplicate, script decides: Arabic text is trusted from the Arabic
  pass, Latin text from the English pass. Then the wider box, then confidence,
  then the text itself - so the merge never depends on pass ordering.
- Duplicated text is harmless to the parsers (`label_value` scores every candidate
  reading and takes the cleanest); lost text is not. The merge is biased to keep.

Tune with `EMPLOYEE_DOCUMENT_OCR_BILINGUAL_LANGUAGES` and
`EMPLOYEE_DOCUMENT_OCR_MERGE_OVERLAP`.

**Known limitation.** A card printed *only* in Arabic with no Latin labels yields
`partial`: the ID number is read and checksum-validated, but name / nationality /
expiry are not, and the warnings say so. Real Iqama and Saudi ID cards are
bilingual and extract at `success`.

## Model provisioning

Models are **never** downloaded at request time. Two supported options:

1. **Baked into the image** (default). `Backend/Dockerfile` runs
   `python -m paddle_models` into `/opt/paddleocr` during the build, in a layer
   *before* the application `COPY` so editing Python source never re-downloads
   models. Build with `--build-arg INSTALL_OCR=0` to skip the OCR stack entirely.
2. **Persistent managed directory.** Point `EMPLOYEE_DOCUMENT_OCR_MODEL_DIR` at a
   mounted volume and run once, from a host with network access:

   ```bash
   docker compose run --rm backend python manage.py provision_ocr_models --model-dir /srv/paddleocr
   docker compose run --rm backend python manage.py provision_ocr_models --verify
   ```

If the models are missing, extraction fails with a `failed` status and an
actionable message rather than silently guessing. `EMPLOYEE_DOCUMENT_OCR_ALLOW_MODEL_DOWNLOAD`
(default `false`) is the only escape hatch and should stay off in production.

## Status rules

| Status | Meaning |
|---|---|
| `pending` | Queued, or claimed by a running job |
| `success` | Every required field present **and** every validation check passed **and** mean confidence >= `EMPLOYEE_DOCUMENT_OCR_MIN_CONFIDENCE` |
| `partial` | Read something, but a field is missing, a check failed, or confidence was low. `extraction_warnings` says which |
| `failed` | Nothing usable was produced. `extraction_error` carries a safe, actionable message |

Validation per type:

- **Passport** - MRZ must be found, and the document-number, date-of-birth and
  expiry check digits must all verify. A composite check-digit mismatch is a
  warning, not a blocker, because a single misread glyph anywhere in the band
  breaks it even when the individual fields are right.
- **Iqama / Saudi ID** - 10 digits, correct leading digit for the type (`2`
  Iqama, `1` Saudi ID), correct Luhn-variant checksum, and a parseable Gregorian
  expiry. Hijri-looking dates are flagged, never converted.
- **Visa** - recognisable visa number, parseable exit date, numeric duration
  within 1-1095 days.

Extraction **never** writes to `EmployeeProfile`. A `success` result describes the
document only; HR still confirms a value before it becomes profile master data.

## Privacy

The full OCR transcript is kept in `EmployeeDocument.extraction_raw_text`, which
is not on the serializer. `EmployeeDocumentSerializer` additionally strips any
legacy `raw_text` key out of `extracted_fields`, and migration `0023` moves
existing transcripts into the private column.

## Runtime notes

`LD_PRELOAD=/lib/x86_64-linux-gnu/libz.so.1` is set in the image and is **required**.
PaddlePaddle's bundled native libraries export their own zlib symbols; without the
preload they override CPython's and the first decompression after `import paddle`
segfaults (Paddle's C++ traceback shows `inflateReset2`). Do not remove it.

Pinned versions that matter, beyond reproducibility:

| Pin | Why |
|---|---|
| `protobuf==4.25.8` | unpinned resolves to protobuf 7, which segfaults PaddlePaddle 2.6 |
| `paddlepaddle==2.6.2` | PaddleOCR 2.x targets the pre-3.0 Paddle API |
| `numpy==1.26.4` | PaddlePaddle 2.6 requires numpy 1.x |
| `setuptools<81` | Paddle imports its C++ extension helpers through setuptools |

Do **not** add PaddleOCR's training extras (`imgaug`, `scikit-image`, `lmdb`,
`albumentations`) - they are unused for inference and current `albucore` builds
pull a hard PyTorch requirement that breaks the image build.

## Tests

| Suite | Runs where |
|---|---|
| `test_document_extraction.py`, `test_document_ocr_parsing.py`, `test_document_ocr_engine.py`, `test_document_ocr_reliability.py` | anywhere - the engine is mocked |
| `test_document_ocr_integration.py` | only where the runtime **and** provisioned models exist; skipped elsewhere with the reason |

Run the real-inference suite inside the built image:

```bash
docker run --rm --network hr-ffi-system_default --user app   -e DB_ENGINE=django.db.backends.postgresql -e DB_NAME=ffi_hr_db -e DB_USER=postgres   -e DB_PASSWORD=postgres -e DB_HOST=db -e DB_PORT=5432   -e DJANGO_ALLOWED_HOSTS=testserver,localhost -e SECURE_SSL_REDIRECT=false   -e DJANGO_SECRET_KEY=<a strong key>   --entrypoint python ffi_hr_backend_ocr:pilot   -m pytest employees/test_document_ocr_integration.py -q -s
```
