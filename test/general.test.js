import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createStore } from '../panel/store.js';
import { createServer } from '../server.js';
import { createNgrok } from '../panel/ngrok.js';
import { checkAddress } from '../panel/addressCheck.js';
import { keepTunnels } from '../routes/generalRoute.js';

const KEY = 'k'.repeat(40);
const headers = { 'x-panel': '1', 'content-type': 'application/json' };

// Two fake apps that report TEST/LIVE and shared settings; every call is recorded
async function startPanel({ ngrok = { configured: false }, checkAddressFn, broken = '' } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nasbeheer-general-'));
    const store = createStore(dir, { firstPassword: 'een-lang-wachtwoord', startApps: [
        { id: 'facturen', name: 'Facturen', url: 'http://factuur-app:8080', key: KEY },
        { id: 'kasper', name: 'Kasper (chat)', url: 'http://casper:8090', key: KEY },
    ] });
    const calls = [];
    const status = {
        facturen: { mode: 'test', testLive: [{ id: 'facturen', label: 'Facturen', mode: 'test', settings: true }, { id: 'webshop', label: 'Webshop', mode: 'test' }], sharedKeys: { shopDomain: 'SHOPIFY_STORE_DOMAIN', contactEmail: 'SELLER_EMAIL' }, shared: { shopDomain: 'hevjuq-bg.myshopify.com', contactEmail: 'info@x.nl' } },
        kasper: { mode: 'test', testLive: [{ id: 'kasper', label: 'Kasper', mode: 'test', settings: true }, { id: 'webshop', label: 'Webshop', mode: 'test' }], sharedKeys: { shopDomain: 'SHOPIFY_STORE_DOMAIN', contactEmail: 'CONTACT_EMAIL_TO' }, shared: { shopDomain: 'hevjuq-bg.myshopify.com', contactEmail: 'info@x.nl' } },
    };
    const callAppFn = async (app, call) => {
        calls.push({ app: app.id, ...call });
        if (app.id === broken) throw new Error('ECONNREFUSED');
        if (call.path === '/status') return { status: 200, data: status[app.id] };
        if (call.path === '/actions/shopify-test') return { status: 200, data: { ok: true, name: 'Lab', message: 'Verbinding gelukt.' } };
        return { status: 200, data: { ok: true } };
    };
    const sessions = { isLoggedIn: () => true };
    const server = createServer({ store, sessions, callAppFn, ngrok, checkAddressFn }).listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const send = (method, url, body) => fetch(`${base}${url}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    return { store, calls, base, send, close: () => server.close() };
}

test('general: one TEST/LIVE row per part (the webshop once), with the app to go to', async () => {
    const p = await startPanel();
    try {
        const g = await (await fetch(`${p.base}/api/general`)).json();
        assert.deepEqual(g.testLive.map((x) => x.id), ['facturen', 'webshop', 'kasper']);
        assert.equal(g.testLive.find((x) => x.id === 'webshop').appId, null);
        assert.equal(g.testLive.find((x) => x.id === 'kasper').appId, 'kasper');
        assert.equal(g.shared.shopDomain.value, 'hevjuq-bg.myshopify.com');
        assert.equal(g.addresses.configured, false);
    } finally {
        p.close();
    }
});

test('general: a shared setting is saved in every app under its own name', async () => {
    const p = await startPanel();
    try {
        const r = await (await p.send('PUT', '/api/general/shared', { name: 'contactEmail', value: 'Info@Lab.nl' })).json();
        assert.equal(r.ok, true);
        const puts = p.calls.filter((c) => c.method === 'PUT');
        assert.deepEqual(puts.map((c) => [c.app, c.body.values]), [['facturen', { SELLER_EMAIL: 'info@lab.nl' }], ['kasper', { CONTACT_EMAIL_TO: 'info@lab.nl' }]]);
    } finally {
        p.close();
    }
});

test('general: shop test asks every app, keeps the app name apart from the shop name', async () => {
    const p = await startPanel();
    try {
        const r = await (await p.send('POST', '/api/general/shop-test', { domain: 'lab.myshopify.com' })).json();
        assert.equal(r.ok, true);
        assert.deepEqual(r.results.map((x) => [x.name, x.shopName]), [['Facturen', 'Lab'], ['Kasper (chat)', 'Lab']]);
    } finally {
        p.close();
    }
});

test('general: an app that does not answer is reported, not hidden', async () => {
    const p = await startPanel({ broken: 'kasper' });
    try {
        const g = await (await fetch(`${p.base}/api/general`)).json();
        assert.deepEqual(g.missing, ['Kasper (chat)']);
    } finally {
        p.close();
    }
});

test('attacks: shared settings, shop addresses and address names are checked before any app is called', async () => {
    const p = await startPanel({ ngrok: { configured: true, reserveDomain: async () => assert.fail('must not reach ngrok') } });
    try {
        const bad = [
            ['PUT', '/api/general/shared', { name: 'ADMIN_KEY', value: 'x' }],
            ['PUT', '/api/general/shared', { name: '__proto__', value: 'x' }],
            ['PUT', '/api/general/shared', { name: 'shopDomain', value: 'evil.com' }],
            ['PUT', '/api/general/shared', { name: 'shopDomain', value: 'a.myshopify.com.evil.com' }],
            ['PUT', '/api/general/shared', { name: 'contactEmail', value: 'a@b.nl\nBcc: c@d.nl' }],
            ['POST', '/api/general/shop-test', { domain: 'http://169.254.169.254/' }],
            ['POST', '/api/addresses/kasper/reserve', { name: '../x' }],
            ['POST', '/api/addresses/kasper/reserve', { name: 'a.evil.com' }],
            ['POST', '/api/addresses/kasper/reserve', { name: '-chat' }],
        ];
        for (const [method, url, body] of bad) {
            const response = await p.send(method, url, body);
            assert.equal(response.status, 400, `${url} ${JSON.stringify(body)}`);
        }
        assert.equal(p.calls.filter((c) => c.method).length, 0);
        assert.equal((await p.send('POST', '/api/addresses/onbekend/reserve', { name: 'x' })).status, 404);
        // Without the X-Panel header: no changes
        assert.equal((await fetch(`${p.base}/api/general/shared`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{"name":"contactEmail","value":"a@b.nl"}' })).status, 403);
    } finally {
        p.close();
    }
});

test('addresses: make, check, and only use it when Hostnet and https both work', async () => {
    let answer = { dns: false, https: false };
    const started = [];
    const ngrok = {
        configured: true,
        agentReachable: async () => true,
        reserveDomain: async (domain) => ({ domain, target: 'abc.ngrok-cname.com' }),
        keepTunnels: async (wanted) => { started.push(...wanted); return []; },
    };
    const p = await startPanel({ ngrok, checkAddressFn: async () => answer });
    try {
        const made = await (await p.send('POST', '/api/addresses/kasper/reserve', { name: 'chat' })).json();
        assert.deepEqual(made, { ok: true, domain: 'chat.laboratoriumdiscounter.nl', target: 'abc.ngrok-cname.com' });
        assert.deepEqual(started[0], { name: 'nasbeheer-kasper', addr: 'casper:8090', domain: 'chat.laboratoriumdiscounter.nl' });

        assert.equal((await p.send('POST', '/api/addresses/facturen/reserve', { name: 'chat' })).status, 400, 'taken by Kasper');
        assert.equal((await p.send('POST', '/api/addresses/kasper/use')).status, 400);
        answer = { dns: true, https: true };
        assert.equal((await p.send('POST', '/api/addresses/kasper/use')).status, 200);
        assert.equal(p.store.addresses().kasper.active, true);
    } finally {
        p.close();
    }
});

test('restart is passed on to the app', async () => {
    const p = await startPanel();
    try {
        assert.equal((await p.send('POST', '/api/apps/facturen/restart')).status, 200);
        assert.ok(p.calls.some((c) => c.app === 'facturen' && c.path === '/restart' && c.method === 'POST'));
    } finally {
        p.close();
    }
});

test('ngrok: reuses an address that exists, makes it otherwise, and only starts missing tunnels', async () => {
    const seen = [];
    const fetchFn = async (url, options = {}) => {
        seen.push([options.method, url, options.body ? JSON.parse(options.body) : null, options.headers]);
        if (url.endsWith('/reserved_domains?limit=100')) return new Response(JSON.stringify({ reserved_domains: [{ domain: 'old.lab.nl', cname_target: 'old.ngrok-cname.com' }] }));
        if (url.endsWith('/reserved_domains')) return new Response(JSON.stringify({ domain: 'new.lab.nl', cname_target: 'new.ngrok-cname.com' }));
        if (url.endsWith('/api/tunnels') && options.method === 'GET') return new Response(JSON.stringify({ tunnels: [{ name: 'nasbeheer-facturen' }] }));
        return new Response('{}', { status: 201 });
    };
    const ngrok = createNgrok({ apiKey: 'key', agentUrl: 'http://ngrok:4040', fetchFn });
    assert.deepEqual(await ngrok.reserveDomain('old.lab.nl'), { domain: 'old.lab.nl', target: 'old.ngrok-cname.com' });
    assert.deepEqual(await ngrok.reserveDomain('new.lab.nl'), { domain: 'new.lab.nl', target: 'new.ngrok-cname.com' });
    assert.equal(seen.find(([method]) => method === 'POST')[3].authorization, 'Bearer key');

    const started = await ngrok.keepTunnels([
        { name: 'nasbeheer-facturen', addr: 'factuur-app:8080', domain: 'facturen.lab.nl' },
        { name: 'nasbeheer-kasper', addr: 'casper:8090', domain: 'chat.lab.nl' },
    ]);
    assert.deepEqual(started, ['nasbeheer-kasper']);
    assert.deepEqual(seen.at(-1)[2], { name: 'nasbeheer-kasper', proto: 'http', addr: 'casper:8090', domain: 'chat.lab.nl' });
});

test('keepTunnels: only saved addresses of apps that still exist', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nasbeheer-tunnels-'));
    const store = createStore(dir, { firstPassword: 'een-lang-wachtwoord', startApps: [{ id: 'kasper', name: 'Kasper', url: 'http://casper:8090', key: KEY }] });
    store.setAddress('kasper', { domain: 'chat.lab.nl', target: 't', active: true });
    store.setAddress('weg', { domain: 'weg.lab.nl', target: 't', active: true });
    let wanted;
    await keepTunnels({ store, ngrok: { configured: true, keepTunnels: async (w) => { wanted = w; return []; } } });
    assert.deepEqual(wanted, [{ name: 'nasbeheer-kasper', addr: 'casper:8090', domain: 'chat.lab.nl' }]);
});

test('address check: Hostnet must point to the ngrok value, and ngrok must not report an error', async () => {
    const ok = new Response('ok');
    assert.deepEqual(await checkAddress({ domain: 'chat.lab.nl', target: 'abc.ngrok-cname.com' }, { resolveCname: async () => ['ABC.ngrok-cname.com.'], fetchFn: async () => ok }), { dns: true, https: true });
    assert.deepEqual(await checkAddress({ domain: 'chat.lab.nl', target: 'abc.ngrok-cname.com' }, { resolveCname: async () => ['other.example.com'], fetchFn: async () => ok }), { dns: false, https: false });
    assert.deepEqual(await checkAddress({ domain: 'chat.lab.nl', target: 'abc.ngrok-cname.com' }, { resolveCname: async () => { throw new Error('ENOTFOUND'); } }), { dns: false, https: false });
    const offline = new Response('offline', { status: 404, headers: { 'ngrok-error-code': 'ERR_NGROK_3200' } });
    assert.deepEqual(await checkAddress({ domain: 'chat.lab.nl', target: 'abc.ngrok-cname.com' }, { resolveCname: async () => ['abc.ngrok-cname.com'], fetchFn: async () => offline }), { dns: true, https: false });
});
