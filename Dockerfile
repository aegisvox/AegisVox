# syntax=docker/dockerfile:1

FROM node:20-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 python3-pip python3-venv libsndfile1 ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --production && npm install --production typescript

COPY .next .next
COPY public public
COPY next.config.ts ./next.config.ts
COPY dist dist

RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/python -m pip install --upgrade pip setuptools wheel \
    && /opt/venv/bin/pip install --no-cache-dir -r dist/backend/requirements.txt

ENV NODE_ENV=production
ENV PORT=3000
ENV PYTHONPATH=/app/dist
ENV PATH=/opt/venv/bin:$PATH
EXPOSE 3000 8000

CMD ["bash", "-lc", "npm run start & exec python3 -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8000"]
