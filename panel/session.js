import crypto from 'node:crypto';

// Login session: a signed cookie that says until when the login is valid. Nothing else is stored in it.
// HttpOnly (scripts cannot read it) and SameSite=Strict (other websites cannot use it).

const COOKIE = 'nasbeheer';

export function createSessions({ secret, hours }) {
    const sign = (value) => crypto.createHmac('sha256', secret()).update(value).digest('base64url');

    return {
        start(res) {
            const value = String(Date.now() + hours * 3600_000);
            res.cookie(COOKIE, `${value}.${sign(value)}`, { httpOnly: true, sameSite: 'strict', maxAge: hours * 3600_000, path: '/' });
        },
        end(res) {
            res.clearCookie(COOKIE, { path: '/' });
        },
        isLoggedIn(req) {
            const raw = cookieValue(req.get('cookie'), COOKIE);
            const [value, signature] = String(raw || '').split('.');
            if (!value || !signature) return false;
            const expected = Buffer.from(sign(value));
            const given = Buffer.from(signature);
            return given.length === expected.length && crypto.timingSafeEqual(given, expected) && Number(value) > Date.now();
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
