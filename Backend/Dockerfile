FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Employee document OCR runs fully self-hosted. Models are baked into the image
# below so the worker never needs outbound network access at runtime.
ENV EMPLOYEE_DOCUMENT_OCR_MODEL_DIR=/opt/paddleocr

# PaddlePaddle's bundled native libraries export their own zlib symbols, which
# override CPython's and corrupt any later decompression (observed as a SIGSEGV
# inside charset_normalizer, and "inflateReset2" in Paddle's C++ traceback).
# Preloading the system zlib makes it win symbol resolution for the whole
# process tree. The OCR wheels are x86_64-only, so this path is fixed.
ENV LD_PRELOAD=/lib/x86_64-linux-gnu/libz.so.1

# Set to 0 to build without the OCR stack (smaller image, OCR reports a clear
# "models are not provisioned" failure instead of guessing).
ARG INSTALL_OCR=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        libpq-dev \
        fonts-dejavu-core \
        libfreetype6-dev \
        libjpeg62-turbo-dev \
        libgl1 \
        libglib2.0-0 \
        libgomp1 \
        zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /app/requirements.txt
COPY requirements-ocr.txt /app/requirements-ocr.txt
RUN pip install --no-cache-dir --default-timeout=100 -r /app/requirements.txt \
    && if [ "$INSTALL_OCR" = "1" ]; then \
         pip install --no-cache-dir --default-timeout=300 -r /app/requirements-ocr.txt; \
       fi

# Download the Arabic and English PaddleOCR models. This is the only step that
# needs the network; afterwards the worker resolves models from disk. It runs
# before the application COPY so editing Python source never re-downloads models.
COPY paddle_models /app/paddle_models
RUN if [ "$INSTALL_OCR" = "1" ]; then \
      mkdir -p "$EMPLOYEE_DOCUMENT_OCR_MODEL_DIR" \
      && python -c "import paddleocr" \
      && python -m paddle_models --model-dir "$EMPLOYEE_DOCUMENT_OCR_MODEL_DIR" \
      && python -m paddle_models --model-dir "$EMPLOYEE_DOCUMENT_OCR_MODEL_DIR" --verify; \
    fi

COPY . /app

RUN sed -i 's/\r$//' /app/entrypoint.sh \
    && chmod +x /app/entrypoint.sh \
    && groupadd --system app \
    && useradd --system --gid app --home-dir /app --no-create-home app \
    && chown -R app:app /app \
    && chown -R app:app "$EMPLOYEE_DOCUMENT_OCR_MODEL_DIR" 2>/dev/null || true

EXPOSE 8000

ENTRYPOINT ["/app/entrypoint.sh"]
