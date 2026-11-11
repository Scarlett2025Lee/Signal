# Public demo of Signal: sample data only, no personal data, no news fetching.
# Build:  docker build -t signal-demo .
# Run:    docker run -p 8080:8080 signal-demo   then open http://localhost:8080
FROM node:24-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY . .
RUN npm run build && npm prune --omit=dev

ENV SIGNAL_DEMO=1 \
    SIGNAL_HOST=0.0.0.0 \
    PORT=8080
EXPOSE 8080
USER node
CMD ["node", "server/index.mjs"]
