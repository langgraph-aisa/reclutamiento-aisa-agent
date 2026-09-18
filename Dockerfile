FROM node:22-alpine AS builder
RUN corepack enable && corepack prepare pnpm@10.4.1 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-alpine AS runner
RUN corepack enable && corepack prepare pnpm@10.4.1 --activate
RUN apk add --no-cache antiword poppler-utils tesseract-ocr tesseract-ocr-data-spa tesseract-ocr-data-eng ffmpeg
WORKDIR /app
RUN addgroup -S nodejs && adduser -S nodejs -G nodejs
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist/public ./dist/public
ENV KNOWLEDGE_STORAGE_DIR=/app/data/knowledge-files
ENV DOCUMENT_OCR_ENABLED=true
RUN mkdir -p /app/uploads /app/data/knowledge-files && chown -R nodejs:nodejs /app
USER nodejs
EXPOSE 3000
CMD ["pnpm", "start"]
