import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// The panel's own small data file (data/panel.json): password hash, session secret and the list of apps.
// It holds the admin keys of the apps, so it is only readable for the panel's user.

export function createStore(dataDir, { firstPassword = '', startApps = [], resetPassword = false } = {}) {
    const file = path.join(dataDir, 'panel.json');
    let data = read();

    function read() {
        try {
            return JSON.parse(fs.readFileSync(file, 'utf8'));
        } catch {
            return {};
        }
    }

    function save() {
        fs.mkdirSync(dataDir, { recursive: true });
        const temp = `${file}.tmp`;
        fs.writeFileSync(temp, JSON.stringify(data, null, 2), { mode: 0o600 });
        fs.renameSync(temp, file);
    }

    // First start: a random session secret, the password from .env, the apps from .env
    let changed = false;
    if (!data.sessionSecret) {
        data.sessionSecret = crypto.randomBytes(32).toString('hex');
        changed = true;
    }
    // A forgotten password: PANEL_PASSWORD_RESET=true makes the .env password count again
    if ((!data.passwordHash || resetPassword) && firstPassword) {
        data.passwordHash = hashPassword(firstPassword);
        changed = true;
    }
    if (!Array.isArray(data.apps)) {
        data.apps = startApps;
        changed = true;
    }
    // A key or address changed in .env wins, so fixing a wrong key in .env is enough
    for (const start of startApps) {
        const app = data.apps.find((a) => a.id === start.id);
        if (app && (app.key !== start.key || app.url !== start.url)) {
            Object.assign(app, { key: start.key, url: start.url });
            changed = true;
        }
    }
    if (changed) save();

    return {
        get sessionSecret() {
            return data.sessionSecret;
        },
        hasPassword: () => Boolean(data.passwordHash),
        checkPassword: (password) => Boolean(data.passwordHash) && verifyPassword(password, data.passwordHash),
        setPassword(password) {
            data.passwordHash = hashPassword(password);
            save();
        },
        apps: () => data.apps.map(({ id, name, url }) => ({ id, name, url })),
        app: (id) => data.apps.find((app) => app.id === id) || null,
        addApp(app) {
            data.apps.push(app);
            save();
        },
        removeApp(id) {
            data.apps = data.apps.filter((app) => app.id !== id);
            save();
        },
        // Fixed internet addresses per app: { domain, target, active }
        addresses: () => ({ ...(data.addresses || {}) }),
        setAddress(appId, address) {
            data.addresses = { ...(data.addresses || {}), [appId]: address };
            save();
        },
    };
}

// scrypt with a random salt: "scrypt$<salt>$<hash>"
export function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
    return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
    const [, salt, hash] = String(stored).split('$');
    if (!salt || !hash) return false;
    const given = crypto.scryptSync(String(password), salt, 64);
    const expected = Buffer.from(hash, 'hex');
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}
