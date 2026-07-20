# syntax=docker/dockerfile:1
# VoiceSaver — single-service deploy: build the Vite frontend, then run the
# FastAPI backend which serves both the /api/* routes and the built frontend.

# ---- Stage 1: build the React/Vite frontend ---------------------------------
FROM node:20-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- Stage 2: python runtime ------------------------------------------------
FROM python:3.13-slim
WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Backend source + runtime config.
COPY src/ ./src/
COPY config/ ./config/

# Simulated-playback WAVs are generated at runtime (and gitignored, so assets/
# isn't in the repo). Just create the writable target dirs the generator uses.
RUN mkdir -p assets/audio frontend/public/audio

# Built frontend from stage 1 (served by FastAPI at "/").
COPY --from=frontend /app/frontend/dist ./frontend/dist

# Render provides $PORT; default to 8000 for local `docker run`.
ENV PORT=8000
EXPOSE 8000
CMD ["sh", "-c", "uvicorn src.server:app --host 0.0.0.0 --port ${PORT:-8000}"]
