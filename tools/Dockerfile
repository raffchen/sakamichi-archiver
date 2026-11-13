FROM python:3.12-slim

WORKDIR /app

# cdp.py (Chrome fallback) needs websocket-client; nothing else
RUN pip install --no-cache-dir websocket-client

COPY . .

ENV PYTHONUNBUFFERED=1 \
    MEDIA_DIR=/data/media \
    LOGS_DIR=/data/logs \
    SYNC_INTERVAL=6h \
    SYNC_SITES=nogizaka46 \
    SYNC_FLAGS=

CMD ["sh", "/app/entrypoint.sh"]
