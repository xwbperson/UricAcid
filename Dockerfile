FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json .env.example ./
COPY src ./src
COPY scripts ./scripts
COPY test ./test
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV PORT=4317
ENV DATA_DIR=/app/data
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY public ./public
RUN mkdir -p /app/data && chown -R node:node /app
USER node
VOLUME ["/app/data"]
EXPOSE 4317
CMD ["node", "dist/src/server.js"]
