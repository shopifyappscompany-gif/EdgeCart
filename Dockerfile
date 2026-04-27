FROM node:20-alpine
RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json* ./

RUN npm ci && npm cache clean --force

COPY . .

# Swap in the PostgreSQL schema and migrations for production
RUN sed -i 's/provider = "sqlite"/provider = "postgresql"/' prisma/schema.prisma && \
    sed -i 's|url      = "file:dev.sqlite"|url      = env("DATABASE_URL")|' prisma/schema.prisma && \
    cp -r prisma/migrations-prod/. prisma/migrations/

RUN npm run build

RUN npm prune --production

CMD ["npm", "run", "docker-start"]
