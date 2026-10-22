import express from 'express';
import { panelGuard, need } from '../panel/guard.js';

// New versions of the apps (built by GitHub after a push to the branch "release"). The panel itself never
// touches Docker: it asks the updater (updater/server.mjs), which only knows a fixed list of apps.
//
//   GET  /api/updates                 per app: what runs and what is downloaded         (everyone)
//   POST /api/updates/:app/check      download the newest version, nothing restarts      (admin)
//   POST /api/updates/:app/update     start the downloaded version (that app restarts)   (admin)
//   POST /api/updates/:app/start      turn on what is off (app and/or tunnel)            (admin)

const NAMES = { facturen: 'Facturen', kasper: 'Kasper (chat)', paneel: 'NAS Beheer (dit paneel)' };

export function updatesRoute({ store, sessions, audit, updaterUrl, updaterKey, fetchFn = fetch }) {
    const router = express.Router();
    router.use(express.json({ limit: '20kb' }));
    router.use(panelGuard({ sessions, store }));

    const configured = Boolean(updaterKey && updaterKey.length >= 32);

    async function ask(method, path, timeoutMs) {
        const response = await fetchFn(`${updaterUrl}${path}`, { method, headers: { authorization: `Bearer ${updaterKey}` }, signal: AbortSignal.timeout(timeoutMs) });
        const data = await response.json().catch(() => ({}));
        if (response.status === 404) throw new Error('De updater weigert de sleutel. Klopt UPDATER_KEY?');
        if (!response.ok) throw new Error(data.message || `De updater antwoordde ${response.status}.`);
        return data;
    }

    router.get('/updates', async (req, res) => {
        if (!configured) return res.json({ configured: false, apps: [] });
        try {
            const data = await ask('GET', '/status', 60_000);
            res.json({ configured: true, busy: data.busy, apps: data.apps.map((a) => ({ ...a, name: NAMES[a.app] || a.app })) });
        } catch (error) {
            res.status(502).json({ message: error.name === 'TimeoutError' || /fetch failed/.test(error.message) ? 'De updater antwoordt niet. Draait de container nas-beheer-updater?' : error.message });
        }
    });

    for (const action of ['check', 'update', 'start']) {
        router.post(`/updates/:app/${action}`, need('admin'), async (req, res) => {
            if (!configured) return res.status(400).json({ message: 'De updater is nog niet ingesteld (UPDATER_KEY, zie de handleiding).' });
            const app = String(req.params.app);
            if (!Object.hasOwn(NAMES, app)) return res.status(404).json({ message: 'Deze app kent de updater niet.' });
            try {
                if (action === 'start') {
                    const { apps } = await ask('GET', '/status', 60_000);
                    if (apps.find((a) => a.app === app)?.started) return res.status(409).json({ message: `${NAMES[app]} staat al aan.` });
                }
                const data = await ask('POST', `/${action}/${app}`, 15 * 60_000);
                const version = data.status?.running || data.status?.newest;
                if (action === 'start') audit.add(req.user, `${NAMES[app]} aangezet`, '');
                else if (action === 'update') audit.add(req.user, `${NAMES[app]} bijgewerkt`, version ? `${version.message || ''} (${String(version.revision || '').slice(0, 7)})`.trim() : '');
                else audit.add(req.user, `Nieuwe versie gezocht voor ${NAMES[app]}`, data.status?.updateReady ? 'nieuwe versie gevonden' : 'geen nieuwe versie');
                res.json({ ok: true, status: { ...data.status, name: NAMES[app] } });
            } catch (error) {
                res.status(502).json({ message: error.message });
            }
        });
    }

    return router;
}
