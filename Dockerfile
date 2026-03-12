FROM node:22-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.build.json tsconfig.json ./
COPY src/ src/

RUN npm run build

# ------- runtime -------
FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ wget \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist/ dist/

ENV CODEX_HOME=/data/codex \
    CODEX_MEM_DATA_DIR=/data/mem \
    NODE_ENV=production

VOLUME ["/data/mem"]

ENTRYPOINT ["node", "dist/cli.js"]
CMD ["worker", "--json"]
