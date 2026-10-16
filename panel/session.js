import crypto from 'node:crypto';

// Login session: a signed cookie with who is logged in and until when. Nothing else is stored in it.
// HttpOnly (scripts cannot read it) and SameSite=Strict (other websites cannot use it).
// The user's "session version" is in it too: after a password or role change it no longer matches,
// so every other login of that user stops working.

const COOKIE = 'nasbeheer';

export function createSessions({ secret, hours }) {
    const sign = (value) => crypto.createHmac('sha256', secret()).update(value).digest('base64url');

    return {
        start(res, user, version) {
            const value = `${user}.${version}.${Date.now() + hours * 3600_000}`;
            res.cookie(COOKIE, `${value}.${sign(value)}`, { httpOnly: true, sameSite: 'strict', maxAge: hours * 3600_000, path: '/' });
        },
        end(res) {
            res.clearCookie(COOKIE, { path: '/' });
        },
        // { userId, version } of a valid, not expired cookie, otherwise null
        read(req) {
            const raw = cookieValue(req.get('cookie'), COOKIE);
            const parts = String(raw || '').split('.');
            if (parts.length !== 4) return null;
            const [userId, version, expires, signature] = parts;
            const expected = Buffer.from(sign(`${userId}.${version}.${expires}`));
            const given = Buffer.from(signature);
            if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
            if (!(Number(expires) > Date.now())) return null;
            return { userId, version: Number(version) };
        },
    };
}

function cookieValue(header, name) {
    for (const part of String(header || '').split(';')) {
        const [key, ...rest] = part.trim().split('=');
        if (key === name) return rest.join('=');
    }
    return null;
}
