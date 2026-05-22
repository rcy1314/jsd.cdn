FROM node:20-alpine AS build
WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

ARG VERSION=dev

COPY tsconfig.json ./
COPY src ./src
RUN npm run build:node

RUN npm prune --omit=dev && npm cache clean --force && rm -rf /root/.npm /tmp/*

FROM alpine:3.23 AS runner
WORKDIR /app

ARG VERSION=dev
ENV NODE_ENV=production
ENV APP_VERSION=${VERSION}
ENV PORT=5011
ENV DB_PATH=/app/data/app.db

RUN apk add --no-cache libstdc++ ca-certificates && update-ca-certificates

COPY --from=build /usr/local/bin/node /usr/local/bin/node

COPY package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

EXPOSE 5011
CMD ["node", "dist/node.js"]
