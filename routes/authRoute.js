import express from 'express';
import { currentUser } from '../panel/guard.js';

// Logging in and out, with a name and a password. After 5 wrong tries from the same computer (or for the
// same name) the next try has to wait 10 minutes.

const MAX_TRIES = 5;
const WAIT_MINUTES = 10;

export function authRoute({ store, sessions, audit }) {
    const router = express.Router();
    const tries = new Map(); // "ip" or "name:<name>" -> { count, until }

    router.use(express.json({ limit: '2kb' }));

    router.get('/session', (req, res) => {
        const user = currentUser(req, { sessions, store });
        res.json({ loggedIn: Boolean(user), user: user ? { name: user.name, role: user.role, mustChange: user.mustChange } : null });
    });

    const blocked = (key) => (tries.get(key)?.until || 0) > Date.now();
    function failed(key) {
        const record = tries.get(key) || { count: 0, until: 0 };
        record.count += 1;
        if (record.count >= MAX_TRIES) Object.assign(record, { count: 0, until: Date.now() + WAIT_MINUTES * 60_000 });
        tries.set(key, record);
    }

    router.post('/login', (req, res) => {
        const name = String(req.body?.name || '').trim().toLowerCase().slice(0, 40);
        const keys = [req.ip, `name:${name}`];
        if (keys.some(blocked)) return res.status(429).json({ message: `Te vaak een verkeerd wachtwoord. Probeer het over ${WAIT_MINUTES} minuten opnieuw.` });

        const user = store.checkLogin(name, String(req.body?.password || ''));
        if (!user) {
            keys.forEach(failed);
            console.log(`Wrong panel login from ${req.ip}`);
            audit.add({ name: name || '(leeg)' }, 'Inloggen mislukt', `vanaf ${req.ip}`);
            return res.status(401).json({ message: 'Naam of wachtwoord klopt niet.' });
        }
        keys.forEach((key) => tries.delete(key));
        sessions.start(res, user.id, store.sessionVersion(user.id));
        audit.add(user, 'Ingelogd', `vanaf ${req.ip}`);
        res.json({ ok: true, user: { name: user.name, role: user.role, mustChange: user.mustChange } });
    });

    router.post('/logout', (req, res) => {
        const user = currentUser(req, { sessions, store });
        if (user) audit.add(user, 'Uitgelogd');
        sessions.end(res);
        res.json({ ok: true });
    });

    return router;
}
