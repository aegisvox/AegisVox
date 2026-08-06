# syntax=docker/dockerfile:1

FROM ubuntu:24.04
WORKDIR /app

VOLUME ["/app/models"]

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl gnupg lsb-release software-properties-common \
        build-essential git unzip zip \
        python3.12 python3.12-venv python3.12-dev \
        libsndfile1 ffmpeg \
        libvulkan1 vulkan-tools libvulkan-dev mesa-vulkan-drivers \
        docker.io \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get update && apt-get install -y --no-install-recommends nodejs \
    && npm install -g npm@latest \
    && rm -rf /var/lib/apt/lists/*

RUN python3.12 -m ensurepip --upgrade \
    && python3.12 -m pip install --no-cache-dir --upgrade pip setuptools wheel

COPY package*.json ./
RUN npm install --production && npm install --production typescript

COPY .next .next
COPY public public
COPY next.config.ts ./next.config.ts
COPY dist dist

RUN python3.12 -m venv /opt/venv \
    && /opt/venv/bin/python -m pip install --no-cache-dir --upgrade pip setuptools wheel \
    && /opt/venv/bin/pip install --no-cache-dir -r dist/backend/requirements.txt

ENV NODE_ENV=production
ENV PORT=3000
ENV PYTHONPATH=/app/dist
ENV MODEL_PATH=/app/models
ENV PATH=/opt/venv/bin:$PATH
EXPOSE 3000 8000

CMD ["bash", "-lc", "npm run start & exec python3.12 -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8000"]
