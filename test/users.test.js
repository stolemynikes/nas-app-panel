import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createStore } from '../panel/store.js';
import { createSessions } from '../panel/session.js';
import { createServer } from '../server.js';
import { createAudit } from '../panel/audit.js';

const PASSWORD = 'een-lang-wachtwoord';
const KEY = 'k'.repeat(40);

// A panel with one fake app that has a normal and a technical setting
async function startPanel() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nasbeheer-users-'));
    const store = createStore(dir, { firstPassword: PASSWORD, startApps: [{ id: 'facturen', name: 'Facturen', url: 'http://factuur-app:8080', key: KEY }] });
    const sessions = createSessions({ secret: () => store.sessionSecret, hours: 1 });
    const audit = createAudit(path.join(dir, 'audit'));
    const calls = [];
    const fields = [
        { key: 'EXACT_SEND_EMAIL', label: 'Mailen?', type: 'bool', value: 'true', choices: [{ value: 'true', title: 'Ja' }, { value: 'false', title: 'Nee' }] },
        { key: 'SHOPIFY_CLIENT_SECRET', label: 'Client secret', type: 'secret', advanced: true, value: null },
        { key: 'SELLER_EMAIL', label: 'Contactadres', type: 'email', shared: 'contactEmail', value: 'info@x.nl' },
    ];
    const callAppFn = async (app, call) => {
        calls.push(call);
        if (call.path === '/settings' && !call.method) return { status: 200, data: { fields } };
        if (call.path === '/status') return { status: 200, data: { level: 'ok' } };
        return { status: 200, data: { ok: true } };
    };
    const server = createServer({ store, sessions, audit, callAppFn }).listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;

    async function login(name, password) {
        const response = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, password }) });
        return { response, cookie: (response.headers.get('set-cookie') || '').split(';')[0] };
    }
    const as = (cookie) => (method, url, body) => fetch(`${base}${url}`, { method, headers: { cookie, 'x-panel': '1', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { store, audit, calls, base, login, as, dir, close: () => server.close() };
}

// Adds a user as the beheerder and logs that user in with an own password
async function userWithRole(p, admin, name, role) {
    await admin('POST', '/api/users', { name, role, password: 'tijdelijk-wachtwoord' });
    const first = await p.login(name, 'tijdelijk-wachtwoord');
    await p.as(first.cookie)('POST', '/api/me/password', { current: 'tijdelijk-wachtwoord', next: `${name}-eigen-wachtwoord` });
    const { cookie } = await p.login(name, `${name}-eigen-wachtwoord`);
    return p.as(cookie);
}

test('the old shared password becomes the user "beheerder"', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nasbeheer-migrate-'));
    fs.writeFileSync(path.join(dir, 'panel.json'), JSON.stringify({ sessionSecret: 'x'.repeat(64), passwordHash: createStoreHash(), apps: [] }));
    const store = createStore(dir);
    assert.equal(store.users().length, 1);
    assert.equal(store.users()[0].name, 'beheerder');
    assert.equal(store.users()[0].role, 'admin');
    assert.ok(store.checkLogin('beheerder', 'oud-gedeeld-wachtwoord'));
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'panel.json'), 'utf8')).passwordHash, undefined, 'the old shared hash is moved, not kept twice');
});

function createStoreHash() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nasbeheer-hash-'));
    const store = createStore(dir, { firstPassword: 'oud-gedeeld-wachtwoord' });
    return JSON.parse(fs.readFileSync(path.join(dir, 'panel.json'), 'utf8')).users.find((u) => u.name === store.users()[0].name).passwordHash;
}

test('login needs the right name and password; the page never gets password hashes', async () => {
    const p = await startPanel();
    try {
        assert.equal((await p.login('beheerder', 'fout-wachtwoord')).response.status, 401);
        assert.equal((await p.login('bestaat-niet', PASSWORD)).response.status, 401);
        const { cookie } = await p.login('Beheerder ', PASSWORD);
        assert.ok(cookie, 'names are not case sensitive');
        const users = await (await p.as(cookie)('GET', '/api/users')).text();
        assert.ok(!users.includes('scrypt$') && !users.includes('passwordHash'));
    } finally {
        p.close();
    }
});

test('a new user must choose an own password first, then can log in with it', async () => {
    const p = await startPanel();
    try {
        const admin = p.as((await p.login('beheerder', PASSWORD)).cookie);
        assert.equal((await admin('POST', '/api/users', { name: 'jan', role: 'staff', password: 'tijdelijk-wachtwoord' })).status, 200);
        const first = p.as((await p.login('jan', 'tijdelijk-wachtwoord')).cookie);
        const blocked = await first('GET', '/api/apps');
        assert.equal(blocked.status, 403);
        assert.equal((await blocked.json()).mustChange, true);
        assert.equal((await first('POST', '/api/me/password', { current: 'tijdelijk-wachtwoord', next: 'tijdelijk-wachtwoord' })).status, 400, 'not the same password');
        assert.equal((await first('POST', '/api/me/password', { current: 'tijdelijk-wachtwoord', next: 'jan-zijn-eigen-zin' })).status, 200);
        assert.equal((await p.login('jan', 'tijdelijk-wachtwoord')).response.status, 401);
        assert.equal((await p.login('jan', 'jan-zijn-eigen-zin')).response.status, 200);
    } finally {
        p.close();
    }
});

test('roles: viewer only looks, staff runs the apps, only admin does technical settings, users and Algemeen', async () => {
    const p = await startPanel();
    try {
        const admin = p.as((await p.login('beheerder', PASSWORD)).cookie);
        const viewer = await userWithRole(p, admin, 'kijker', 'viewer');
        const staff = await userWithRole(p, admin, 'medewerker', 'staff');

        assert.equal((await viewer('GET', '/api/apps')).status, 200);
        for (const [method, url, body] of [['POST', '/api/apps/facturen/restart'], ['POST', '/api/apps/facturen/enabled', { enabled: false }], ['PUT', '/api/apps/facturen/settings', { values: { EXACT_SEND_EMAIL: 'false' } }], ['POST', '/api/apps/facturen/actions/retry', { orderId: '1' }]]) {
            assert.equal((await viewer(method, url, body)).status, 403, `viewer ${url}`);
        }

        assert.equal((await staff('POST', '/api/apps/facturen/restart')).status, 200);
        assert.equal((await staff('PUT', '/api/apps/facturen/settings', { values: { EXACT_SEND_EMAIL: 'false' } })).status, 200);
        assert.equal((await staff('PUT', '/api/apps/facturen/settings', { values: { SHOPIFY_CLIENT_SECRET: 'shpss_nieuw_geheim_123' } })).status, 403, 'technical');
        assert.equal((await staff('PUT', '/api/apps/facturen/settings', { values: { SELLER_EMAIL: 'a@b.nl' } })).status, 403, 'shared');
        assert.equal((await staff('GET', '/api/users')).status, 403);
        assert.equal((await staff('GET', '/api/audit')).status, 403);
        assert.equal((await staff('PUT', '/api/general/shared', { name: 'contactEmail', value: 'a@b.nl' })).status, 403);
        assert.equal((await staff('POST', '/api/users', { name: 'stiekem', role: 'admin', password: 'een-lang-wachtwoord' })).status, 403);

        assert.equal((await admin('PUT', '/api/apps/facturen/settings', { values: { SHOPIFY_CLIENT_SECRET: 'shpss_nieuw_geheim_123' } })).status, 200);
    } finally {
        p.close();
    }
});

test('a role change or a new password ends the other logins of that user; a removed user is logged out', async () => {
    const p = await startPanel();
    try {
        const admin = p.as((await p.login('beheerder', PASSWORD)).cookie);
        const staff = await userWithRole(p, admin, 'piet', 'staff');
        assert.equal((await staff('GET', '/api/apps')).status, 200);
        const piet = p.store.users().find((u) => u.name === 'piet');
        await admin('PUT', `/api/users/${piet.id}`, { role: 'viewer' });
        assert.equal((await staff('GET', '/api/apps')).status, 401);

        const again = p.as((await p.login('piet', 'piet-eigen-wachtwoord')).cookie);
        assert.equal((await again('GET', '/api/apps')).status, 200);
        await admin('DELETE', `/api/users/${piet.id}`);
        assert.equal((await again('GET', '/api/apps')).status, 401);
    } finally {
        p.close();
    }
});

test('attacks: bad names, short passwords, unknown roles, and never zero beheerders', async () => {
    const p = await startPanel();
    try {
        const admin = p.as((await p.login('beheerder', PASSWORD)).cookie);
        for (const body of [
            { name: '../x', role: 'staff', password: 'een-lang-wachtwoord' },
            { name: 'a b', role: 'staff', password: 'een-lang-wachtwoord' },
            { name: '<script>', role: 'staff', password: 'een-lang-wachtwoord' },
            { name: 'jan', role: 'god', password: 'een-lang-wachtwoord' },
            { name: 'jan', role: '__proto__', password: 'een-lang-wachtwoord' },
            { name: 'jan', role: 'staff', password: 'kort' },
            { name: 'beheerder', role: 'staff', password: 'een-lang-wachtwoord' },
        ]) {
            assert.equal((await admin('POST', '/api/users', body)).status, 400, JSON.stringify(body));
        }
        const me = p.store.users()[0];
        assert.equal((await admin('PUT', `/api/users/${me.id}`, { role: 'viewer' })).status, 400, 'last beheerder');
        assert.equal((await admin('DELETE', `/api/users/${me.id}`)).status, 400, 'yourself');
        assert.equal(p.store.users()[0].role, 'admin');
    } finally {
        p.close();
    }
});

test('login: 5 wrong passwords for one name blocks that name for a while', async () => {
    const p = await startPanel();
    try {
        for (let i = 0; i < 5; i += 1) await p.login('beheerder', 'fout');
        assert.equal((await p.login('beheerder', PASSWORD)).response.status, 429);
    } finally {
        p.close();
    }
});

test('action log: who changed what, old → new, never secrets', async () => {
    const p = await startPanel();
    try {
        const admin = p.as((await p.login('beheerder', PASSWORD)).cookie);
        await admin('PUT', '/api/apps/facturen/settings', { values: { EXACT_SEND_EMAIL: 'false', SHOPIFY_CLIENT_SECRET: 'shpss_super_geheim_456' } });
        await admin('POST', '/api/apps/facturen/restart');
        await admin('POST', '/api/users', { name: 'jan', role: 'viewer', password: 'tijdelijk-wachtwoord' });
        const { entries } = await (await admin('GET', '/api/audit')).json();
        const text = JSON.stringify(entries);
        assert.ok(text.includes('Mailen?: Ja → Nee'));
        assert.ok(text.includes('Client secret: nieuwe waarde'));
        assert.ok(text.includes('Facturen opnieuw gestart'));
        assert.ok(text.includes('Gebruiker toegevoegd'));
        assert.ok(text.includes('Ingelogd'));
        assert.ok(entries.every((e) => e.user === 'beheerder'));
        assert.ok(!text.includes('shpss_super_geheim') && !text.includes('tijdelijk-wachtwoord'));
        const files = fs.readdirSync(path.join(p.dir, 'audit')).map((f) => fs.readFileSync(path.join(p.dir, 'audit', f), 'utf8')).join('');
        assert.ok(!files.includes('shpss_super_geheim') && !files.includes('tijdelijk-wachtwoord'));
        const onlyJan = await (await admin('GET', '/api/audit?user=jan')).json();
        assert.equal(onlyJan.entries.length, 0);
    } finally {
        p.close();
    }
});
