// The updater: the only part of NAS Beheer that may use Docker on the NAS. It does three fixed things for
// the apps in UPDATE_APPS, and only when the panel asks with the right key:
//
//   GET  /status          per app: the version that runs, the newest version that is downloaded, and whether it is on
//   POST /check/:app      download the newest version from GitHub (ghcr.io); nothing restarts
//   POST /update/:app     start the downloaded version (only that app restarts; .env, data and folders stay).
//                         The panel also uses this for "Aanzetten": the same command starts a stopped app.
//
// Nothing from a request ever goes into a command: the app name is looked up in the fixed list, and the
// commands are fixed. Only reachable inside the Docker network nas-apps (no ports), with UPDATER_KEY.
// Plain Node.js, no packages.

import http from 'node:http';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';

const KEY = (process.env.UPDATER_KEY || '').trim();
const PROJECTS_DIR = (process.env.PROJECTS_DIR || '/volume1/docker').replace(/\/$/, '');
const PORT = Number(process.env.PORT || 8090);

// "facturen=factuur-app/factuur-app,kasper=casper/casper" -> app id = compose project / service
export function parseApps(text) {
    const apps = {};
    for (const part of String(text || '').split(',').map((p) => p.trim()).filter(Boolean)) {
        const match = part.match(/^([a-z0-9-]{1,30})=([a-z0-9][a-z0-9_-]{0,40})\/([a-z0-9][a-z0-9_-]{0,40})$/);
        if (match) apps[match[1]] = { project: match[2], service: match[3] };
    }
    return apps;
}
const APPS = parseApps(process.env.UPDATE_APPS || 'facturen=factuur-app/factuur-app,kasper=casper/casper,paneel=nas-beheer/nas-beheer');

function run(command, args, { input, timeoutMs = 10 * 60_000 } = {}) {
    return new Promise((resolve, reject) => {
        const child = execFile(command, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) return reject(Object.assign(new Error(String(stderr || error.message).trim().slice(-500)), { stdout }));
            resolve(String(stdout));
        });
        if (input) {
            child.stdin.end(input);
        }
    });
}

const compose = (app, ...args) => ['compose', '-p', app.project, '--project-directory', `${PROJECTS_DIR}/${app.project}`, ...args];

async function inspect(ref) {
    try {
        const [data] = JSON.parse(await run('docker', ['inspect', ref], { timeoutMs: 30_000 }));
        return data;
    } catch {
        return null;
    }
}

// The labels GitHub puts on the image: which commit, when, and the first line of the commit message
const versionOf = (image) => (image ? {
    id: image.Id,
    revision: image.Config?.Labels?.['org.opencontainers.image.revision'] || null,
    created: image.Config?.Labels?.['org.opencontainers.image.created'] || image.Created || null,
    message: image.Config?.Labels?.['org.opencontainers.image.description'] || null,
} : null);

async function appStatus(id, app) {
    // -a: also a stopped container, so the panel can offer "Aanzetten"
    const containerId = (await run('docker', compose(app, 'ps', '-a', '-q', app.service), { timeoutMs: 30_000 }).catch(() => '')).trim().split('\n')[0];
    const container = containerId ? await inspect(containerId) : null;
    const imageName = container?.Config?.Image || null;
    const running = container ? versionOf(await inspect(container.Image)) : null;
    const newest = imageName ? versionOf(await inspect(imageName)) : null;
    return {
        app: id,
        image: imageName,
        fromGithub: Boolean(imageName && imageName.startsWith('ghcr.io/')),
        started: Boolean(container?.State?.Running),
        running,
        newest,
        updateReady: Boolean(running && newest && running.id !== newest.id),
    };
}

let busy = null; // one Docker job at a time

async function handle(req, res) {
    const send = (status, body) => {
        res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify(body));
    };
    const expected = Buffer.from(`Bearer ${KEY}`);
    const given = Buffer.from(String(req.headers.authorization || ''));
    // Same answer for every refusal; requests that came through a proxy are never accepted
    if (KEY.length < 32 || given.length !== expected.length || !crypto.timingSafeEqual(given, expected) || req.headers['x-forwarded-for']) return send(404, { message: 'Not found' });

    const [, action, id] = (req.url || '').split('?')[0].split('/');
    if (req.method === 'GET' && action === 'status') {
        const apps = [];
        for (const [appId, app] of Object.entries(APPS)) apps.push(await appStatus(appId, app));
        return send(200, { apps, busy });
    }
    const app = Object.hasOwn(APPS, id || '') ? APPS[id] : null;
    if (req.method !== 'POST' || !['check', 'update'].includes(action) || !app) return send(404, { message: 'Not found' });
    if (busy) return send(409, { message: `Er loopt al een update (${busy}). Probeer het zo opnieuw.` });

    busy = `${action} ${id}`;
    try {
        if (action === 'check') {
            await run('docker', compose(app, 'pull', app.service));
            console.log(`Checked ${id}: newest version downloaded`);
        } else {
            // --no-build: never build on the NAS, only start the downloaded version
            await run('docker', compose(app, 'up', '-d', '--no-build', app.service));
            console.log(`Updated ${id}`);
        }
        return send(200, { ok: true, status: await appStatus(id, app) });
    } catch (error) {
        console.log(`${action} ${id} failed: ${error.message}`);
        return send(500, { message: `Niet gelukt: ${error.message}` });
    } finally {
        busy = null;
    }
}

// Logs in to ghcr.io once at the start, so private images can be downloaded (a read-only token)
async function login() {
    const user = (process.env.GHCR_USER || '').trim();
    const token = (process.env.GHCR_TOKEN || '').trim();
    if (!user || !token) return console.log('No GHCR_USER / GHCR_TOKEN: only public images can be downloaded');
    try {
        await run('docker', ['login', 'ghcr.io', '-u', user, '--password-stdin'], { input: `${token}\n`, timeoutMs: 60_000 });
        console.log(`Logged in to ghcr.io as ${user}`);
    } catch (error) {
        console.log(`Login to ghcr.io failed: ${error.message}`);
    }
}

if (process.argv[1]?.endsWith('server.mjs')) {
    if (KEY.length < 32) {
        console.log('Please set UPDATER_KEY (at least 32 characters, the same in the panel)');
        process.exit(1);
    }
    await login();
    http.createServer((req, res) => handle(req, res).catch((error) => {
        console.log(`Error: ${error.message}`);
        res.writeHead(500);
        res.end();
    })).listen(PORT, () => console.log(`Updater ready on port ${PORT} for: ${Object.keys(APPS).join(', ')}`));
}
