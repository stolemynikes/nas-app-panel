import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createStore } from '../panel/store.js';
import { createSessions } from '../panel/session.js';
import { createServer } from '../server.js';
import { createAudit } from '../panel/audit.js';
import { parseApps } from '../updater/server.mjs';

const PASSWORD = 'een-lang-wachtwoord';
const UPDATER_KEY = 'u'.repeat(40);

async function startPanel() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nasbeheer-updates-'));
    const store = createStore(dir, { firstPassword: PASSWORD, startApps: [] });
    const sessions = createSessions({ secret: () => store.sessionSecret, hours: 1 });
    const audit = createAudit(path.join(dir, 'audit'));
    const calls = [];
    const version = (id, message) => ({ id, revision: 'abcdef1234567', created: '2026-10-16T12:00:00Z', message });
    const fetchFn = async (url, options) => {
        calls.push({ url, method: options.method, auth: options.headers.authorization });
        if (url.endsWith('/status')) return new Response(JSON.stringify({ apps: [{ app: 'facturen', running: version('a', 'oud'), newest: version('b', 'Nieuwe layout'), updateReady: true, fromGithub: true }] }));
        return new Response(JSON.stringify({ ok: true, status: { app: 'facturen', running: version('b', 'Nieuwe layout'), updateReady: false } }));
    };
    const server = createServer({ store, sessions, audit, updater: { url: 'http://nas-beheer-updater:8090', key: UPDATER_KEY, fetchFn } }).listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const login = async (name, password) => (await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, password }) })).headers.get('set-cookie').split(';')[0];
    const as = (cookie) => (method, url, body) => fetch(`${base}${url}`, { method, headers: { cookie, 'x-panel': '1', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { store, calls, login, as, audit, close: () => server.close() };
}

test('updater: only well-formed app names, nothing else gets into a command', () => {
    assert.deepEqual(parseApps('facturen=factuur-app/factuur-app, kasper=casper/casper'), {
        facturen: { project: 'factuur-app', service: 'factuur-app' },
        kasper: { project: 'casper', service: 'casper' },
    });
    assert.deepEqual(parseApps('x=../etc/passwd,y=a;rm -rf/b,z=a b/c,Q=a/b'), {});
});

test('updates: everyone can see, only a beheerder can download or start a version; it goes in the action log', async () => {
    const p = await startPanel();
    try {
        const admin = p.as(await p.login('beheerder', PASSWORD));
        await admin('POST', '/api/users', { name: 'jan', role: 'staff', password: 'tijdelijk-wachtwoord' });
        await p.as(await p.login('jan', 'tijdelijk-wachtwoord'))('POST', '/api/me/password', { current: 'tijdelijk-wachtwoord', next: 'jan-eigen-wachtwoord' });
        const staff = p.as(await p.login('jan', 'jan-eigen-wachtwoord'));

        const seen = await (await staff('GET', '/api/updates')).json();
        assert.equal(seen.apps[0].name, 'Facturen');
        assert.equal(seen.apps[0].updateReady, true);
        assert.equal((await staff('POST', '/api/updates/facturen/update')).status, 403);
        assert.equal(p.calls.filter((c) => c.method === 'POST').length, 0);

        assert.equal((await admin('POST', '/api/updates/onbekend/update')).status, 404);
        assert.equal((await admin('POST', '/api/updates/__proto__/update')).status, 404);
        assert.equal((await admin('POST', '/api/updates/facturen/update')).status, 200);
        assert.equal(p.calls.at(-1).url, 'http://nas-beheer-updater:8090/update/facturen');
        assert.equal(p.calls.at(-1).auth, `Bearer ${UPDATER_KEY}`);
        assert.ok(JSON.stringify(p.audit.read()).includes('Facturen bijgewerkt'));
        assert.ok(JSON.stringify(p.audit.read()).includes('Nieuwe layout (abcdef1)'));
    } finally {
        p.close();
    }
});
