# NAS Beheer

One web page on the office network to look after the apps on the Synology NAS: **Facturen** (the invoice app) and **Kasper** (the chat). Colleagues can see whether everything works, what needs attention, change settings, switch an app on or off and read a plain-Dutch logbook.

Installation on the NAS (Dutch, step by step): [docs/installatie-nl.md](docs/installatie-nl.md).

## How it works

- The panel is its own container (`nas-beheer`, port 8081, office network only). No tunnel goes to it and the port must never be forwarded in the router.
- Each app has internal admin routes (`/internal/admin/status`, `settings`, `enabled`, `log`, `actions/:action`). They only answer with the right `ADMIN_KEY` (at least 32 characters) and refuse requests that came through a tunnel.
- The panel and the apps talk over the shared Docker network `nas-apps`. The browser only talks to the panel; the admin keys never reach the browser.
- Settings changed in the panel are saved by the app in its own `data/settings.json` (on top of `.env`); the app then restarts itself. On/off is a setting too, so the panel never needs access to Docker.
- The logbook is kept by each app for 30 days and shown in plain Dutch, with the technical line behind a switch.
- Settings are shown as plain questions with answer cards. Each app describes them itself (`fields()` in its admin provider: `choices`, `mode` TEST/LIVE, `risky`, `shared`). The app's status also reports `mode`, `testLive`, `connections` and `sharedKeys`.
- Tab **Algemeen** holds what all apps share: TEST/LIVE overview, the Shopify store (`shopDomain`) and the shop contact address (`contactEmail`). The panel saves a shared value in every app under that app's own setting name (`sharedKeys`). Switching the store is tested first with each app's read-only `shopify-test` action.
- **Restart**: `POST /internal/admin/restart` in each app; Docker starts it again. A restart re-reads `data/settings.json`, not `.env`.
- **Fixed addresses**: the panel makes an address under `BASE_DOMAIN` with the ngrok API (`NGROK_API_KEY`) and shows the CNAME value for Hostnet. The container `nas-beheer-ngrok` (profile `ngrok`) runs the tunnels; the panel starts them through the agent API on port 4040 and starts them again every 5 minutes (`keepTunnels`). The DNS record at Hostnet stays manual. Apps with `PUBLIC_URL=auto` (Facturen) use whatever address a request came in on, so nothing in the app changes.

## Security

- One shared panel password (at least 12 characters), stored as an scrypt hash in `data/panel.json`. After 5 wrong tries a computer waits 10 minutes.
- Login is a signed cookie (HttpOnly, SameSite=Strict, 12 hours). Changes also need the header `X-Panel: 1`, so other websites cannot make changes with a colleague's login.
- The page loads nothing from outside (strict Content-Security-Policy) and builds everything with `textContent`, never `innerHTML`.
- The ngrok agent API (port 4040) has no password. It is only reachable inside the Docker network `nas-apps`, never published as a port. Every container in that network could start a tunnel with it, so only put trusted apps in `nas-apps`.
- Store addresses must end in `.myshopify.com` and address names may only hold `a-z`, `0-9` and `-`; both are checked in the panel and again in the apps.

## Commands

```
npm install
npm test                       # node --test
npm start                      # http://localhost:8081
node scripts/makeNasPackage.js # build/nas-beheer-nas.zip for the NAS (without .env and data)
```

Settings come from `.env` (see `.env.example`). Never commit `.env`.

## Files

- `index.js` start, `server.js` the Express app, `config.js` settings
- `routes/authRoute.js` login/logout, `routes/appsRoute.js` the panel API (passes calls on to the apps), `routes/generalRoute.js` tab Algemeen + fixed addresses
- `panel/store.js` password, app list, fixed addresses; `panel/session.js` login cookie; `panel/guard.js` login + X-Panel check; `panel/appClient.js` calls to an app
- `panel/ngrok.js` ngrok API + agent, `panel/addressCheck.js` DNS + https check, `ngrok.yml` settings of the ngrok container
- `public/` the page (plain HTML, CSS and JavaScript)

## Adding an app later

1. Copy `admin/` from the invoice app into the new app and write a small provider (status, fields, validate, actions), like `admin/kasperAdmin.js` in Kasper.
2. Give the app an `ADMIN_KEY` and put it in the network `nas-apps`.
3. In the panel: tab **Paneel** → **App toevoegen**.
