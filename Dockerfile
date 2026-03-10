FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.build.json tsconfig.json ./
COPY src/ src/

RUN npm run build

# ------- runtime -------
FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY --from=builder /app/dist/ dist/

ENV CODEX_HOME=/data/codex \
    CODEX_MEM_DATA_DIR=/data/mem \
    NODE_ENV=production

VOLUME ["/data/mem"]

ENTRYPOINT ["node", "dist/cli.js"]
CMD ["worker", "--json"]
