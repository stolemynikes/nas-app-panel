# NAS Beheer as a container, for Synology Container Manager. Built and started by docker-compose.yml.
FROM node:24-slim

WORKDIR /app
ENV NODE_ENV=production

# Install the packages first, so a rebuild after a code change is fast
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

# The data folder (password hash, app keys) belongs to the container's own user, never root
RUN mkdir -p /app/data && chown node:node /app/data
USER node

EXPOSE 8081

# Container Manager shows the panel as "unhealthy" when it stops answering
HEALTHCHECK --interval=1m --timeout=10s --start-period=20s \
    CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8081) + '/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "index.js"]
