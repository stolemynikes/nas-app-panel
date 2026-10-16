import express from 'express';
import { callApp } from '../panel/appClient.js';
import { panelGuard } from '../panel/guard.js';

// The panel's own API for the page in the browser. Everything needs a login (see panel/guard.js).
//
//   GET    /api/apps                         apps with their status
//   GET    /api/apps/:id/status|settings     from that app
//   PUT    /api/apps/:id/settings            save settings (the app restarts)
//   POST   /api/apps/:id/enabled             switch on or off
//   POST   /api/apps/:id/restart             restart the app
//   POST   /api/apps/:id/actions/:action     e.g. retry an order, connect Exact
//   GET    /api/log                          the logbooks of all apps together
//   POST   /api/apps                         add an app        DELETE /api/apps/:id   remove it from the panel
//   POST   /api/password                     change the panel password

export function appsRoute({ store, sessions, callAppFn = callApp }) {
    const router = express.Router();
    router.use(express.json({ limit: '20kb' }));

    router.use(panelGuard(sessions));

    const appOr404 = (req, res) => {
        const app = store.app(req.params.id);
        if (!app) res.status(404).json({ message: 'Deze app bestaat niet (meer).' });
        return app;
    };

    // Forwards a call and passes the app's answer on; an app that does not answer gets a clear message
    async function forward(res, app, call) {
        try {
            const { status, data } = await callAppFn(app, call);
            // The app answers 404 for a wrong key (on purpose the same as "does not exist")
            if (status === 404) return res.status(502).json({ message: `${app.name} geeft geen toegang of kent deze vraag niet. Klopt de beheersleutel, en is de app bijgewerkt?` });
            return res.status(status).json(data);
        } catch {
            return res.status(502).json({ message: `${app.name} antwoordt niet. Staat de app aan op de NAS?` });
        }
    }

    router.get('/apps', async (req, res) => {
        const apps = await Promise.all(
            store.apps().map(async (summary) => {
                try {
                    const { status, data } = await callAppFn(store.app(summary.id), { path: '/status', timeoutMs: 5000 });
                    if (status !== 200) return { ...summary, reachable: false, problem: 'Geen toegang. Klopt de beheersleutel?' };
                    return { ...summary, reachable: true, status: data };
                } catch {
                    return { ...summary, reachable: false, problem: 'Antwoordt niet. Staat de app aan op de NAS?' };
                }
            }),
        );
        res.json({ apps });
    });

    router.get('/apps/:id/status', (req, res) => {
        const app = appOr404(req, res);
        if (app) forward(res, app, { path: '/status' });
    });

    router.get('/apps/:id/settings', (req, res) => {
        const app = appOr404(req, res);
        if (app) forward(res, app, { path: '/settings' });
    });

    router.put('/apps/:id/settings', (req, res) => {
        const app = appOr404(req, res);
        if (!app) return;
        console.log(`Settings of ${app.name} changed: ${Object.keys(req.body?.values || {}).join(', ')}`);
        forward(res, app, { method: 'PUT', path: '/settings', body: { values: req.body?.values } });
    });

    router.post('/apps/:id/enabled', (req, res) => {
        const app = appOr404(req, res);
        if (!app) return;
        console.log(`${app.name} switched ${req.body?.enabled ? 'on' : 'off'}`);
        forward(res, app, { method: 'POST', path: '/enabled', body: { enabled: req.body?.enabled === true } });
    });

    router.post('/apps/:id/restart', (req, res) => {
        const app = appOr404(req, res);
        if (!app) return;
        console.log(`${app.name} restarted`);
        forward(res, app, { method: 'POST', path: '/restart' });
    });

    router.post('/apps/:id/actions/:action', (req, res) => {
        const app = appOr404(req, res);
        if (!app) return;
        if (!/^[a-z0-9-]{1,40}$/.test(req.params.action)) return res.status(400).json({ message: 'Onbekende actie.' });
        forward(res, app, { method: 'POST', path: `/actions/${req.params.action}`, body: req.body || {} });
    });

    // All logbooks together, newest first, each line marked with its app
    router.get('/log', async (req, res) => {
        const level = ['problems', 'bad', 'warn', 'ok'].includes(req.query.level) ? req.query.level : '';
        const q = encodeURIComponent(String(req.query.q || '').slice(0, 100));
        const only = String(req.query.app || '');
        const entries = [];
        const missing = [];
        for (const summary of store.apps().filter((a) => !only || a.id === only)) {
            try {
                const { status, data } = await callAppFn(store.app(summary.id), { path: `/log?level=${level}&q=${q}&days=30`, timeoutMs: 5000 });
                if (status === 200) entries.push(...data.entries.map((entry) => ({ ...entry, app: summary.name, appId: summary.id })));
                else missing.push(summary.name);
            } catch {
                missing.push(summary.name);
            }
        }
        entries.sort((a, b) => (a.time < b.time ? 1 : -1));
        res.json({ entries: entries.slice(0, 400), missing });
    });

    router.post('/apps', async (req, res) => {
        const name = String(req.body?.name || '').trim().slice(0, 60);
        const url = String(req.body?.url || '').trim();
        const key = String(req.body?.key || '').trim();
        if (!name) return res.status(400).json({ message: 'Vul een naam in.' });
        if (!/^https?:\/\/[a-z0-9.-]+(:\d{1,5})?\/?$/i.test(url)) return res.status(400).json({ message: 'Het adres moet er zo uitzien: http://naam-van-de-container:8080' });
        if (key.length < 32) return res.status(400).json({ message: 'De beheersleutel moet minstens 32 tekens hebben (dezelfde als ADMIN_KEY in die app).' });
        const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'app';
        if (store.app(id)) return res.status(400).json({ message: 'Er is al een app met deze naam.' });
        const app = { id, name, url: url.replace(/\/$/, ''), key };
        try {
            const { status } = await callAppFn(app, { path: '/status', timeoutMs: 5000 });
            if (status !== 200) return res.status(400).json({ message: 'De app antwoordt, maar weigert de sleutel. Controleer ADMIN_KEY.' });
        } catch {
            return res.status(400).json({ message: 'Geen antwoord op dit adres. Staat de app aan en zit hij in het netwerk nas-apps?' });
        }
        store.addApp(app);
        console.log(`App added to the panel: ${name}`);
        res.json({ ok: true, id });
    });

    router.delete('/apps/:id', (req, res) => {
        const app = appOr404(req, res);
        if (!app) return;
        store.removeApp(app.id);
        console.log(`App removed from the panel: ${app.name}`);
        res.json({ ok: true });
    });

    router.post('/password', (req, res) => {
        const current = String(req.body?.current || '');
        const next = String(req.body?.next || '');
        if (!store.checkPassword(current)) return res.status(400).json({ message: 'Het huidige wachtwoord klopt niet.' });
        if (next.length < 12) return res.status(400).json({ message: 'Kies een wachtwoord van minstens 12 tekens.' });
        store.setPassword(next);
        console.log('Panel password changed');
        res.json({ ok: true });
    });

    return router;
}
