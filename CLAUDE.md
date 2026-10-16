# CLAUDE.md

Guidance for Claude Code in this repository. Read `README.md` first.

## What this is

The admin panel on the Synology NAS for the apps of Laboratoriumdiscounter (Facturen in `C:\development\invoice_generator`, Kasper in `C:\development\chatbot`). Plain JavaScript (ES modules), Node 24+, Express, no other packages. The page in `public/` is plain HTML/CSS/JS without libraries.

## Commands

```
npm test                         # node --test test/*.test.js, all must pass
npm start                        # http://localhost:8081
node scripts/makeNasPackage.js   # zip for the NAS
```

On Windows PowerShell use `npm.cmd` or `node`.

## Code style

- Plain JavaScript, no TypeScript, simple Express layout (`index.js`, `config.js`, `routes/xRoute.js`).
- Short `//` comments in plain English that explain why. Everything colleagues see is in plain Dutch.

## Rules that must never be broken

1. **Office network only.** No tunnel to this container, never tell anyone to forward port 8081.
2. **Admin keys never reach the browser.** `store.apps()` (used for the page) leaves the key out; keep it that way.
3. **Every `/api` call needs a login; every change also needs `X-Panel: 1`.** Keep the "attacks" tests passing and add one for every new input.
4. **Never `innerHTML`** in `public/app.js`: build with `h()` (textContent). Nothing loaded from outside (CSP `'self'`).
5. **The panel never touches Docker.** On/off and settings go through the app's own admin routes. Only the updater (`updater/server.mjs`) has the Docker socket: it runs fixed `docker compose pull/up -d --no-build` commands for the fixed list in `UPDATE_APPS`, only when the panel asks with `UPDATER_KEY`, never on its own. Never put request data into its commands, and never give it a port.
6. **Updates come only from the branch `release`** (`.github/workflows/release.yml`: tests first, then the image to ghcr.io). Pushing to `release` is not going live: a beheerder clicks "Bijwerken" in the panel.
7. **Secrets stay secret.** Never print `.env` values or `data/panel.json`; never commit them.
8. Nothing on the NAS changes without the owner's OK.

## How to check your work

- `npm test` after every change.
- For page changes: run a demo with fake apps and take a headless Edge screenshot, then look at it.
