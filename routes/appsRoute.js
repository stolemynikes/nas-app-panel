import express from 'express';
import { callApp } from '../panel/appClient.js';
import { panelGuard, need, can } from '../panel/guard.js';

// The panel's own API for the page in the browser. Everything needs a login (see panel/guard.js).
//
//   GET    /api/apps                         apps with their status                          (everyone)
//   GET    /api/apps/:id/status|settings     from that app                                   (everyone)
//   GET    /api/log                          the logbooks of all apps together               (everyone)
//   PUT    /api/apps/:id/settings            save settings (the app restarts)                (staff; technical ones admin)
//   POST   /api/apps/:id/enabled             switch on or off                                (staff)
//   POST   /api/apps/:id/restart             restart the app                                 (staff)
//   POST   /api/apps/:id/actions/:action     e.g. retry an order, connect Exact              (staff)
//   POST   /api/apps                         add an app        DELETE /api/apps/:id          (admin)
//
// Every change goes into the action log (panel/audit.js), never with secrets.

export function appsRoute({ store, sessions, audit, callAppFn = callApp }) {
    const router = express.Router();
    router.use(express.json({ limit: '20kb' }));
    router.use(panelGuard({ sessions, store }));

    const appOr404 = (req, res) => {
        const app = store.app(req.params.id);
        if (!app) res.status(404).json({ message: 'Deze app bestaat niet (meer).' });
        return app;
    };

    // Forwards a call and passes the app's answer on; an app that does not answer gets a clear message.
    // Returns true when the app said yes (for the action log).
    async function forward(res, app, call) {
        try {
            const { status, data } = await callAppFn(app, call);
            // The app answers 404 for a wrong key (on purpose the same as "does not exist")
            if (status === 404) {
                res.status(502).json({ message: `${app.name} geeft geen toegang of kent deze vraag niet. Klopt de beheersleutel, en is de app bijgewerkt?` });
                return false;
            }
            res.status(status).json(data);
            return status === 200;
        } catch {
            res.status(502).json({ message: `${app.name} antwoordt niet. Staat de app aan op de NAS?` });
            return false;
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

    router.put('/apps/:id/settings', need('staff'), async (req, res) => {
        const app = appOr404(req, res);
        if (!app) return;
        const values = req.body?.values;
        if (!values || typeof values !== 'object' || Array.isArray(values)) return res.status(400).json({ message: 'Er is niets om op te slaan.' });

        // The current settings: who may change what, and the old values for the action log
        let fields;
        try {
            const { status, data } = await callAppFn(app, { path: '/settings' });
            if (status !== 200) throw new Error();
            fields = data.fields;
        } catch {
            return res.status(502).json({ message: `${app.name} antwoordt niet. Er is niets opgeslagen.` });
        }
        const byKey = new Map(fields.map((f) => [f.key, f]));
        for (const key of Object.keys(values)) {
            const field = byKey.get(key);
            if (!field) return res.status(400).json({ message: `${key} kan hier niet worden aangepast.` });
            // Shared settings go through tab Algemeen; technical ones only for a beheerder
            if ((field.shared || field.advanced) && !can(req.user, 'admin')) return res.status(403).json({ message: `"${field.label}" mag alleen een beheerder aanpassen.` });
        }

        const ok = await forward(res, app, { method: 'PUT', path: '/settings', body: { values } });
        if (ok) {
            const show = (field, value) => (field.type === 'secret' ? 'nieuwe waarde' : field.choices?.find((c) => c.value === value)?.title || value || '(leeg)');
            const changes = Object.entries(values).map(([key, value]) => {
                const field = byKey.get(key);
                return field.type === 'secret' ? `${field.label}: nieuwe waarde` : `${field.label}: ${show(field, field.value)} → ${show(field, String(value))}`;
            });
            audit.add(req.user, `Instellingen ${app.name}`, changes.join('; '));
        }
    });

    router.post('/apps/:id/enabled', need('staff'), async (req, res) => {
        const app = appOr404(req, res);
        if (!app) return;
        const enabled = req.body?.enabled === true;
        if (await forward(res, app, { method: 'POST', path: '/enabled', body: { enabled } })) audit.add(req.user, `${app.name} ${enabled ? 'aangezet' : 'uitgezet'}`);
    });

    router.post('/apps/:id/restart', need('staff'), async (req, res) => {
        const app = appOr404(req, res);
        if (!app) return;
        if (await forward(res, app, { method: 'POST', path: '/restart' })) audit.add(req.user, `${app.name} opnieuw gestart`);
    });

    router.post('/apps/:id/actions/:action', need('staff'), async (req, res) => {
        const app = appOr404(req, res);
        if (!app) return;
        const action = req.params.action;
        if (!/^[a-z0-9-]{1,40}$/.test(action)) return res.status(400).json({ message: 'Onbekende actie.' });
        const body = req.body || {};
        if (await forward(res, app, { method: 'POST', path: `/actions/${action}`, body })) {
            // Only what helps to understand the action; never the Exact login address (it holds a code)
            const detail = action === 'retry' ? `order-id ${String(body.orderId || '').slice(0, 20)}` : action === 'shopify-test' ? String(body.domain || '').slice(0, 80) : '';
            const names = { retry: 'Order opnieuw geprobeerd', 'exact-connect': 'Exact koppelen gestart', 'exact-code': 'Exact gekoppeld', 'test-mail': 'Testmail verstuurd', 'shopify-test': 'Webshop getest' };
            audit.add(req.user, `${app.name}: ${names[action] || action}`, detail);
        }
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

    router.post('/apps', need('admin'), async (req, res) => {
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
        audit.add(req.user, 'App toegevoegd aan het paneel', `${name} (${app.url})`);
        res.json({ ok: true, id });
    });

    router.delete('/apps/:id', need('admin'), (req, res) => {
        const app = appOr404(req, res);
        if (!app) return;
        store.removeApp(app.id);
        audit.add(req.user, 'App uit het paneel gehaald', app.name);
        res.json({ ok: true });
    });

    return router;
}
