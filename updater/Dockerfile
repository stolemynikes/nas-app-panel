# The updater (see updater/server.mjs): Docker's own command line tool + Node.js, nothing else.
FROM docker:27-cli
RUN apk add --no-cache nodejs
WORKDIR /updater
COPY updater/server.mjs ./server.mjs
CMD ["node", "server.mjs"]
