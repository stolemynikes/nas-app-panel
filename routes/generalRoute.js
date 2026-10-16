import express from 'express';
import { callApp } from '../panel/appClient.js';
import { panelGuard } from '../panel/guard.js';
import { checkAddress } from '../panel/addressCheck.js';

// The tab "Algemeen": things that are the same for all apps.
//
//   GET  /api/general                        test or live per part, the shared settings, the fixed addresses
//   POST /api/general/shop-test              can every app read this Shopify store? (read-only)
//   PUT  /api/general/shared                 save a shared setting (webshop, contact address) in every app
//   POST /api/addresses/:appId/reserve       make a fixed address at ngrok and start its tunnel
//   POST /api/addresses/:appId/check         is it filled in at Hostnet and does it answer over https?
//   POST /api/addresses/:appId/use           mark it as the address of the app

const SHARED = {
    shopDomain: { label: 'Webshop', valid: (v) => /^[a-z0-9][a-z0-9-]{0,60}\.myshopify\.com$/.test(v), problem: 'Het adres moet eindigen op .myshopify.com, bijvoorbeeld laboratoriumdiscounter.myshopify.com.' },
    contactEmail: { label: 'Contactadres', valid: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 200, problem: 'Dit is geen geldig e-mailadres.' },
};

export function generalRoute({ store, sessions, ngrok, baseDomain, callAppFn = callApp, checkAddressFn = checkAddress }) {
    const router = express.Router();
    router.use(express.json({ limit: '10kb' }));
    router.use(panelGuard(sessions));

    // The status of every app (apps that do not answer are left out, with their name in "missing")
    async function statuses() {
        const result = await Promise.all(store.apps().map(async (summary) => {
            try {
                const { status, data } = await callAppFn(store.app(summary.id), { path: '/status', timeoutMs: 5000 });
                return status === 200 ? { ...summary, status: data } : { ...summary, status: null };
            } catch {
                return { ...summary, status: null };
            }
        }));
        return result;
    }

    router.get('/general', async (req, res) => {
        const apps = await statuses();
        const reachable = apps.filter((a) => a.status);

        // One row per part. A part several apps report (the webshop) is shown once.
        const testLive = [];
        for (const app of reachable) {
            for (const part of app.status.testLive || []) {
                if (testLive.some((p) => p.id === part.id)) continue;
                testLive.push({ ...part, appId: part.settings ? app.id : null });
            }
        }

        const shared = {};
        for (const name of Object.keys(SHARED)) {
            const users = reachable.filter((a) => a.status.sharedKeys?.[name]);
            shared[name] = {
                value: users[0]?.status.shared?.[name] || '',
                apps: users.map((a) => ({ id: a.id, name: a.name, value: a.status.shared?.[name] || '', level: (a.status.connections || []).find((c) => c.id === 'webshop')?.level || 'ok' })),
            };
        }

        const saved = store.addresses();
        const addresses = apps.map((a) => ({ appId: a.id, name: a.name, ...(saved[a.id] || {}) }));

        res.json({
            testLive,
            shared,
            missing: apps.filter((a) => !a.status).map((a) => a.name),
            addresses: { configured: ngrok.configured, agent: ngrok.configured ? await ngrok.agentReachable() : false, baseDomain, list: addresses },
        });
    });

    router.post('/general/shop-test', async (req, res) => {
        const domain = String(req.body?.domain || '').trim().toLowerCase();
        if (!SHARED.shopDomain.valid(domain)) return res.status(400).json({ message: SHARED.shopDomain.problem });
        const apps = (await statuses()).filter((a) => a.status?.sharedKeys?.shopDomain);
        const results = await Promise.all(apps.map(async (app) => {
            try {
                const { status, data } = await callAppFn(store.app(app.id), { method: 'POST', path: '/actions/shopify-test', body: { domain }, timeoutMs: 25_000 });
                // The app's answer has the shop's name; "name" stays the name of the app
                return status === 200 ? { ...data, shopName: data?.name, id: app.id, name: app.name } : { id: app.id, name: app.name, ok: false, message: 'Deze app kan dit nog niet testen. Is hij bijgewerkt?' };
            } catch {
                return { id: app.id, name: app.name, ok: false, message: 'Deze app antwoordt niet.' };
            }
        }));
        res.json({ domain, results, ok: results.length > 0 && results.every((r) => r.ok) });
    });

    router.put('/general/shared', async (req, res) => {
        const name = String(req.body?.name || '');
        const value = String(req.body?.value || '').trim().toLowerCase();
        if (!Object.hasOwn(SHARED, name)) return res.status(400).json({ message: 'Onbekende instelling.' });
        if (!SHARED[name].valid(value)) return res.status(400).json({ message: SHARED[name].problem });
        const apps = (await statuses()).filter((a) => a.status?.sharedKeys?.[name]);
        if (!apps.length) return res.status(502).json({ message: 'Geen enkele app antwoordt. Er is niets opgeslagen.' });
        console.log(`Shared setting ${name} changed for: ${apps.map((a) => a.name).join(', ')}`);
        const results = [];
        for (const app of apps) {
            try {
                const { status, data } = await callAppFn(store.app(app.id), { method: 'PUT', path: '/settings', body: { values: { [app.status.sharedKeys[name]]: value } } });
                results.push({ id: app.id, name: app.name, ok: status === 200, message: status === 200 ? 'Opgeslagen.' : data?.message || 'Niet opgeslagen.' });
            } catch {
                results.push({ id: app.id, name: app.name, ok: false, message: 'Antwoordt niet. Niet opgeslagen.' });
            }
        }
        res.json({ results, ok: results.every((r) => r.ok) });
    });

    // ---------- fixed addresses ----------

    const appOr404 = (req, res) => {
        const app = store.app(req.params.appId);
        if (!app) res.status(404).json({ message: 'Deze app bestaat niet (meer).' });
        return app;
    };

    router.post('/addresses/:appId/reserve', async (req, res) => {
        const app = appOr404(req, res);
        if (!app) return;
        if (!ngrok.configured) return res.status(400).json({ message: 'ngrok is nog niet ingesteld. Vraag de beheerder NGROK_API_KEY in te vullen (zie de handleiding).' });
        const name = String(req.body?.name || '').trim().toLowerCase();
        if (!/^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/.test(name)) return res.status(400).json({ message: 'Gebruik alleen kleine letters, cijfers en een streepje (niet aan het begin of eind).' });
        const domain = `${name}.${baseDomain}`;
        const taken = Object.entries(store.addresses()).find(([id, a]) => id !== app.id && a.domain === domain);
        if (taken) return res.status(400).json({ message: 'Dit adres hoort al bij een andere app.' });
        try {
            const { target } = await ngrok.reserveDomain(domain);
            store.setAddress(app.id, { domain, target, active: false });
            console.log(`Fixed address ${domain} made at ngrok for ${app.name}`);
            await keepTunnels({ store, ngrok }).catch(() => {});
            res.json({ ok: true, domain, target });
        } catch (error) {
            console.log(`ngrok refused ${domain}: ${error.message}`);
            res.status(502).json({ message: 'ngrok kon dit adres niet aanmaken. Klopt de ngrok-sleutel, en hoort het domein bij jullie ngrok-account?' });
        }
    });

    router.post('/addresses/:appId/check', async (req, res) => {
        const app = appOr404(req, res);
        if (!app) return;
        const address = store.addresses()[app.id];
        if (!address?.domain) return res.status(400).json({ message: 'Maak eerst een adres aan.' });
        await keepTunnels({ store, ngrok }).catch(() => {});
        res.json(await checkAddressFn(address));
    });

    router.post('/addresses/:appId/use', async (req, res) => {
        const app = appOr404(req, res);
        if (!app) return;
        const address = store.addresses()[app.id];
        if (!address?.domain) return res.status(400).json({ message: 'Maak eerst een adres aan.' });
        const check = await checkAddressFn(address);
        if (!check.dns || !check.https) return res.status(400).json({ message: 'Het adres werkt nog niet. Controleer het eerst.' });
        store.setAddress(app.id, { ...address, active: true });
        console.log(`${app.name} now uses the fixed address ${address.domain}`);
        res.json({ ok: true, domain: address.domain });
    });

    return router;
}

// Starts the tunnels of all saved addresses that are not running (after a restart of the ngrok container)
export async function keepTunnels({ store, ngrok }) {
    if (!ngrok.configured) return [];
    const wanted = Object.entries(store.addresses())
        .filter(([, a]) => a.domain)
        .map(([appId, a]) => ({ appId, app: store.app(appId), domain: a.domain }))
        .filter((t) => t.app)
        .map((t) => ({ name: `nasbeheer-${t.appId}`, addr: t.app.url.replace(/^https?:\/\//, ''), domain: t.domain }));
    return ngrok.keepTunnels(wanted);
}
