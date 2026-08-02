# syntax=docker/dockerfile:1

FROM node:20-slim AS builder
WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

FROM node:20-slim AS runner
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 python3-pip libsndfile1 ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/app ./app
COPY --from=builder /app/components ./components
COPY --from=builder /app/dist ./dist

RUN python3 -m pip install --no-cache-dir -r dist/backend/requirements.txt

ENV PORT=3000
ENV PYTHONPATH=/app/dist
EXPOSE 3000 8000

CMD ["bash", "-lc", "npm run start & exec python3 -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8000"]
