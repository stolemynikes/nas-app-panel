# NAS Beheer as a container, for Synology Container Manager. Built and started by docker-compose.yml.
FROM node:24-slim

WORKDIR /app
ENV NODE_ENV=production
# Less RAM on the NAS: Node cleans up sooner instead of growing (the panel is small)
ENV NODE_OPTIONS="--max-old-space-size=96 --max-semi-space-size=2"

# Install the packages first, so a rebuild after a code change is fast
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

# The data folder (password hash, app keys) belongs to the container's own user, never root
RUN mkdir -p /app/data && chown node:node /app/data
USER node

EXPOSE 8081

# Container Manager shows the panel as "unhealthy" when it stops answering.
# Plain bash instead of a second Node process: asking "are you there?" every minute then costs almost no RAM.
HEALTHCHECK --interval=1m --timeout=10s --start-period=20s \
    CMD bash -c 'exec 3<>/dev/tcp/127.0.0.1/${PORT:-8081} && printf "GET /health HTTP/1.0\r\n\r\n" >&3 && head -n 1 <&3 | grep -q " 200 "'

CMD ["node", "index.js"]
