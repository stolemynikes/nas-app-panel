import express from 'express';

// Logging in and out. After 5 wrong passwords from the same computer, it has to wait 10 minutes.

const MAX_TRIES = 5;
const WAIT_MINUTES = 10;

export function authRoute({ store, sessions }) {
    const router = express.Router();
    const tries = new Map(); // ip -> { count, until }

    router.use(express.json({ limit: '2kb' }));

    router.get('/session', (req, res) => res.json({ loggedIn: sessions.isLoggedIn(req), hasPassword: store.hasPassword() }));

    router.post('/login', (req, res) => {
        const ip = req.ip;
        const record = tries.get(ip) || { count: 0, until: 0 };
        if (record.until > Date.now()) return res.status(429).json({ message: `Te vaak een verkeerd wachtwoord. Probeer het over ${WAIT_MINUTES} minuten opnieuw.` });

        if (!store.checkPassword(String(req.body?.password || ''))) {
            record.count += 1;
            if (record.count >= MAX_TRIES) Object.assign(record, { count: 0, until: Date.now() + WAIT_MINUTES * 60_000 });
            tries.set(ip, record);
            console.log(`Wrong panel password from ${ip}`);
            return res.status(401).json({ message: 'Dat wachtwoord klopt niet.' });
        }
        tries.delete(ip);
        sessions.start(res);
        res.json({ ok: true });
    });

    router.post('/logout', (req, res) => {
        sessions.end(res);
        res.json({ ok: true });
    });

    return router;
}
