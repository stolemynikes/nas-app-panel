import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

//routes import
import { authRoute } from './routes/authRoute.js';
import { appsRoute } from './routes/appsRoute.js';
import { generalRoute } from './routes/generalRoute.js';

// The Express app, apart from index.js so the tests can use it without starting a server
export function createServer({ store, sessions, callAppFn, ngrok = { configured: false }, baseDomain = 'laboratoriumdiscounter.nl', checkAddressFn }) {
    const app = express();
    app.disable('x-powered-by');

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
    app.use('/auth', authRoute({ store, sessions }));
    app.use('/api', generalRoute({ store, sessions, ngrok, baseDomain, callAppFn, checkAddressFn }));
    app.use('/api', appsRoute({ store, sessions, callAppFn }));
    app.get('/health', (req, res) => res.send('ok'));
    app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), 'public')));

    app.use((req, res) => res.status(404).send('Not found'));
    app.use((error, req, res, next) => {
        console.log(`Error on ${req.method} ${req.path}: ${error.message}`);
        if (res.headersSent) return next(error);
        res.status(500).json({ message: 'Er ging iets mis.' });
    });
    return app;
}
