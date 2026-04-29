FROM python:3.12-slim

WORKDIR /app

RUN pip install --no-cache-dir httpx feedparser

COPY job.py ./

RUN useradd --uid 1000 --create-home --shell /usr/sbin/nologin ionet \
 && mkdir -p /var/data && chown -R 1000:1000 /var/data /app
USER 1000:1000

CMD ["python", "-u", "job.py"]
