import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import crypto from 'node:crypto';

//routes import
import { authRoute } from './routes/authRoute.js';
import { appsRoute } from './routes/appsRoute.js';
import { generalRoute } from './routes/generalRoute.js';
import { usersRoute } from './routes/usersRoute.js';
import { updatesRoute } from './routes/updatesRoute.js';

// The Express app, apart from index.js so the tests can use it without starting a server
export function createServer({ store, sessions, audit, callAppFn, updater = {}, ngrok = { configured: false }, baseDomain = 'laboratoriumdiscounter.nl', checkAddressFn }) {
    const app = express();
    app.disable('x-powered-by');
    const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');

    // Protection headers: only our own files, no framing, no passing on of addresses
    app.use((req, res, next) => {
        res.set({
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY',
            'Referrer-Policy': 'no-referrer',
            'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'; form-action 'self'",
        });
        next();
    });

    //ROUTES
    app.use('/auth', authRoute({ store, sessions, audit }));
    app.use('/api', usersRoute({ store, sessions, audit }));
    app.use('/api', updatesRoute({ store, sessions, audit, updaterUrl: updater.url, updaterKey: updater.key, fetchFn: updater.fetchFn }));
    app.use('/api', generalRoute({ store, sessions, audit, ngrok, baseDomain, callAppFn, checkAddressFn }));
    app.use('/api', appsRoute({ store, sessions, audit, callAppFn }));
    app.get('/health', (req, res) => res.send('ok'));
    // The version of the page: open browsers reload by themselves after an update of the panel
    // Worked out again every few seconds: new page files on the NAS (see docker-compose.yml) count at once
    // Per file, so the page can swap only the styles live, and reload (keeping its place) only for code
    let version = { files: fileVersions(publicDir), at: Date.now() };
    app.get('/version', (req, res) => {
        if (Date.now() - version.at > 5000) version = { files: fileVersions(publicDir), at: Date.now() };
        res.set('Cache-Control', 'no-store').json({ files: version.files });
    });
    app.use(express.static(publicDir, { etag: true, maxAge: 0 }));

    app.use((req, res) => res.status(404).send('Not found'));
    app.use((error, req, res, next) => {
        console.log(`Error on ${req.method} ${req.path}: ${error.message}`);
        if (res.headersSent) return next(error);
        res.status(500).json({ message: 'Er ging iets mis.' });
    });
    return app;
}

// A short fingerprint of every file of the page
function fileVersions(dir) {
    const files = {};
    for (const file of fs.readdirSync(dir).sort()) files[file] = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, file))).digest('hex').slice(0, 12);
    return files;
}
