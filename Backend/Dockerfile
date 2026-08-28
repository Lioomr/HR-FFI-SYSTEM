FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        libpq-dev \
        fonts-dejavu-core \
        libfreetype6-dev \
        libjpeg62-turbo-dev \
        tesseract-ocr \
        tesseract-ocr-ara \
        tesseract-ocr-eng \
        zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir --default-timeout=100 -r /app/requirements.txt

COPY . /app

RUN sed -i 's/\r$//' /app/entrypoint.sh \
    && chmod +x /app/entrypoint.sh \
    && groupadd --system app \
    && useradd --system --gid app --home-dir /app --no-create-home app \
    && chown -R app:app /app

EXPOSE 8000

ENTRYPOINT ["/app/entrypoint.sh"]
