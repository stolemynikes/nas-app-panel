import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createStore, hashPassword, verifyPassword } from '../panel/store.js';
import { createSessions } from '../panel/session.js';
import { createServer } from '../server.js';
import { callApp } from '../panel/appClient.js';
import { createAudit } from '../panel/audit.js';

const PASSWORD = 'een-lang-wachtwoord';
const KEY = 'k'.repeat(40);

// A panel with a fake app behind it; calls to the app are recorded
async function startPanel({ answer } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nasbeheer-'));
    const store = createStore(dir, { firstPassword: PASSWORD, startApps: [{ id: 'facturen', name: 'Facturen', url: 'http://factuur-app:8080', key: KEY }] });
    const sessions = createSessions({ secret: () => store.sessionSecret, hours: 1 });
    const calls = [];
    const callAppFn = async (app, call) => {
        calls.push({ app, ...call });
        if (answer) return answer(app, call);
        if (call.path === '/status') return { status: 200, data: { level: 'ok', summary: 'Alles loopt.' } };
        if (call.path.startsWith('/log')) return { status: 200, data: { entries: [{ time: '2026-10-16T10:00:00Z', level: 'ok', plain: 'Factuur gemaakt.', tech: 'x' }] } };
        return { status: 200, data: { ok: true } };
    };
    const audit = createAudit(path.join(dir, 'audit'));
    const server = createServer({ store, sessions, audit, callAppFn }).listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    return { store, calls, base, dir, audit, close: () => server.close() };
}

async function login(base, password = PASSWORD, name = 'beheerder') {
    const response = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, password }) });
    const cookie = (response.headers.get('set-cookie') || '').split(';')[0];
    return { response, cookie };
}

test('password hash: right and wrong password', () => {
    const stored = hashPassword('geheim-wachtwoord');
    assert.ok(stored.startsWith('scrypt$'));
    assert.equal(verifyPassword('geheim-wachtwoord', stored), true);
    assert.equal(verifyPassword('ander-wachtwoord', stored), false);
    assert.equal(verifyPassword('x', 'rommel'), false);
});

test('store: panel.json keeps no plain password and survives a restart', async () => {
    const p = await startPanel();
    p.close();
    const raw = fs.readFileSync(path.join(p.dir, 'panel.json'), 'utf8');
    assert.ok(!raw.includes(PASSWORD));
    const again = createStore(p.dir, { firstPassword: 'iets-anders-nu', startApps: [] });
    assert.ok(again.checkLogin('beheerder', PASSWORD), 'the .env password only counts the first time');
    assert.equal(again.apps().length, 1);
    assert.equal(again.apps()[0].key, undefined, 'the list for the page never holds the key');
});

test('store: a new key in .env wins, and the password can be reset', async () => {
    const p = await startPanel();
    p.close();
    const newKey = 'n'.repeat(40);
    const again = createStore(p.dir, { firstPassword: 'nieuw-wachtwoord-9', resetPassword: true, startApps: [{ id: 'facturen', name: 'Facturen', url: 'http://factuur-app:8080', key: newKey }] });
    assert.equal(again.app('facturen').key, newKey);
    assert.ok(again.checkLogin('beheerder', 'nieuw-wachtwoord-9'));
    assert.equal(again.checkLogin('beheerder', PASSWORD), null);
});

test('without login: no API, no logbook', async () => {
    const p = await startPanel();
    try {
        for (const url of ['/api/apps', '/api/log', '/api/apps/facturen/settings']) {
            const response = await fetch(`${p.base}${url}`);
            assert.equal(response.status, 401, url);
        }
        assert.equal(p.calls.length, 0);
    } finally {
        p.close();
    }
});

test('login: wrong password refused, right one gives a HttpOnly SameSite=Strict cookie', async () => {
    const p = await startPanel();
    try {
        assert.equal((await login(p.base, 'fout')).response.status, 401);
        const { response } = await login(p.base);
        assert.equal(response.status, 200);
        const header = response.headers.get('set-cookie');
        assert.match(header, /HttpOnly/i);
        assert.match(header, /SameSite=Strict/i);
    } finally {
        p.close();
    }
});

test('login: after 5 wrong passwords even the right one has to wait', async () => {
    const p = await startPanel();
    try {
        for (let i = 0; i < 5; i += 1) await login(p.base, 'fout');
        assert.equal((await login(p.base)).response.status, 429);
    } finally {
        p.close();
    }
});

test('a forged or expired cookie does not work', async () => {
    const p = await startPanel();
    try {
        const forged = `nasbeheer=${Date.now() + 3600_000}.abc`;
        assert.equal((await fetch(`${p.base}/api/apps`, { headers: { cookie: forged } })).status, 401);
        const old = createSessions({ secret: () => p.store.sessionSecret, hours: -1 });
        let cookie = '';
        const me = p.store.users()[0];
        old.start({ cookie: (name, value) => (cookie = `${name}=${value}`) }, me.id, p.store.sessionVersion(me.id));
        assert.equal((await fetch(`${p.base}/api/apps`, { headers: { cookie } })).status, 401);
    } finally {
        p.close();
    }
});

test('changes need the X-Panel header (no changes from other websites)', async () => {
    const p = await startPanel();
    try {
        const { cookie } = await login(p.base);
        const without = await fetch(`${p.base}/api/apps/facturen/enabled`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{"enabled":false}' });
        assert.equal(without.status, 403);
        assert.equal(p.calls.length, 0);
        const withHeader = await fetch(`${p.base}/api/apps/facturen/enabled`, { method: 'POST', headers: { cookie, 'x-panel': '1', 'content-type': 'application/json' }, body: '{"enabled":false}' });
        assert.equal(withHeader.status, 200);
        assert.deepEqual(p.calls.at(-1).body, { enabled: false });
    } finally {
        p.close();
    }
});

test('apps list: status from the app, and never the admin key', async () => {
    const p = await startPanel();
    try {
        const { cookie } = await login(p.base);
        const text = await (await fetch(`${p.base}/api/apps`, { headers: { cookie } })).text();
        assert.ok(!text.includes(KEY));
        const { apps } = JSON.parse(text);
        assert.equal(apps[0].reachable, true);
        assert.equal(apps[0].status.summary, 'Alles loopt.');
    } finally {
        p.close();
    }
});

test('an app that refuses the key or does not answer gives a clear message', async () => {
    const p = await startPanel({
        answer: async (app, call) => {
            if (call.path === '/settings') return { status: 404, data: null };
            throw new Error('ECONNREFUSED');
        },
    });
    try {
        const { cookie } = await login(p.base);
        const { apps } = await (await fetch(`${p.base}/api/apps`, { headers: { cookie } })).json();
        assert.equal(apps[0].reachable, false);
        assert.match(apps[0].problem, /Antwoordt niet/);
        const settings = await fetch(`${p.base}/api/apps/facturen/settings`, { headers: { cookie } });
        assert.equal(settings.status, 502);
        assert.match((await settings.json()).message, /beheersleutel/);
    } finally {
        p.close();
    }
});

test('attacks: odd action names and unknown apps never reach an app', async () => {
    const p = await startPanel();
    try {
        const { cookie } = await login(p.base);
        const headers = { cookie, 'x-panel': '1', 'content-type': 'application/json' };
        for (const action of ['..%2Fsettings', 'RETRY', 'a'.repeat(41), 'retry%3Fx%3D1']) {
            const response = await fetch(`${p.base}/api/apps/facturen/actions/${action}`, { method: 'POST', headers, body: '{}' });
            assert.notEqual(response.status, 200, action);
        }
        assert.equal((await fetch(`${p.base}/api/apps/bestaat-niet/status`, { headers: { cookie } })).status, 404);
        assert.equal(p.calls.length, 0);
    } finally {
        p.close();
    }
});

test('attacks: adding an app checks the address and the key', async () => {
    const p = await startPanel();
    try {
        const { cookie } = await login(p.base);
        const headers = { cookie, 'x-panel': '1', 'content-type': 'application/json' };
        const add = (body) => fetch(`${p.base}/api/apps`, { method: 'POST', headers, body: JSON.stringify(body) });
        assert.equal((await add({ name: 'X', url: 'file:///etc/passwd', key: KEY })).status, 400);
        assert.equal((await add({ name: 'X', url: 'http://evil.com/pad?x=1', key: KEY })).status, 400);
        assert.equal((await add({ name: 'X', url: 'http://andere-app:3000', key: 'kort' })).status, 400);
        assert.equal((await add({ name: 'Facturen', url: 'http://andere-app:3000', key: KEY })).status, 400, 'same name');
        const ok = await add({ name: 'Andere app', url: 'http://andere-app:3000/', key: KEY });
        assert.equal(ok.status, 200);
        assert.equal(p.store.app('andere-app').url, 'http://andere-app:3000');
    } finally {
        p.close();
    }
});

test('logbook: lines of all apps together, search passed on safely', async () => {
    const p = await startPanel();
    try {
        const { cookie } = await login(p.base);
        const { entries } = await (await fetch(`${p.base}/api/log?q=${encodeURIComponent('LD1008&level=x')}&level=hack`, { headers: { cookie } })).json();
        assert.equal(entries[0].app, 'Facturen');
        const call = p.calls.find((c) => c.path.startsWith('/log'));
        assert.equal(call.path, '/log?level=&q=LD1008%26level%3Dx&days=30');
    } finally {
        p.close();
    }
});

test('password change: needs the current password and 12 characters', async () => {
    const p = await startPanel();
    try {
        const { cookie } = await login(p.base);
        const headers = { cookie, 'x-panel': '1', 'content-type': 'application/json' };
        const change = (body) => fetch(`${p.base}/api/me/password`, { method: 'POST', headers, body: JSON.stringify(body) });
        assert.equal((await change({ current: 'fout', next: 'nieuw-wachtwoord-1' })).status, 400);
        assert.equal((await change({ current: PASSWORD, next: 'kort' })).status, 400);
        assert.equal((await change({ current: PASSWORD, next: 'nieuw-wachtwoord-1' })).status, 200);
        assert.ok(p.store.checkLogin('beheerder', 'nieuw-wachtwoord-1'));
    } finally {
        p.close();
    }
});

test('the page has safety headers, loads nothing from outside and never uses innerHTML', async () => {
    const p = await startPanel();
    try {
        const response = await fetch(`${p.base}/`);
        assert.equal(response.status, 200);
        assert.match(response.headers.get('content-security-policy'), /default-src 'self'/);
        assert.equal(response.headers.get('x-frame-options'), 'DENY');
        const files = ['index.html', 'app.js', 'styles.css'].map((f) => fs.readFileSync(path.join(import.meta.dirname, '..', 'public', f), 'utf8')).join('\n');
        // Nothing is loaded from elsewhere: no outside src/href, no url(http...) in the CSS, no fetch to another site
        assert.ok(!/(src|href)="https?:/i.test(files), 'no outside files in the HTML');
        assert.ok(!/url\(\s*['"]?https?:/i.test(files), 'no outside files in the CSS');
        assert.ok(!/fetch\(\s*[`'"]https?:/i.test(files), 'no fetch to another site');
        assert.ok(!/\.(innerHTML|outerHTML|insertAdjacentHTML)\b/.test(files), 'never innerHTML');
    } finally {
        p.close();
    }
});

test('appClient: sends the key as Bearer to /internal/admin', async () => {
    let seen;
    const fetchFn = async (url, options) => {
        seen = { url, options };
        return new Response('{"ok":true}', { status: 200 });
    };
    const result = await callApp({ url: 'http://factuur-app:8080/', key: KEY }, { path: '/status', fetchFn });
    assert.equal(seen.url, 'http://factuur-app:8080/internal/admin/status');
    assert.equal(seen.options.headers.authorization, `Bearer ${KEY}`);
    assert.deepEqual(result, { status: 200, data: { ok: true } });
});
