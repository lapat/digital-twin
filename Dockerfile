FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# Hugging Face Spaces (Docker SDK) expects the container to listen on 7860
# by default. Any other host (Railway, Render, Fly.io, Cloud Run, ...) sets
# PORT itself and this just follows it.
ENV PORT=7860
EXPOSE 7860

CMD ["node", "server.js"]
