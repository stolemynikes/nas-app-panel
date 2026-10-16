import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// The panel's own small data file (data/panel.json): the users (with password hashes), session secret and the list of apps.
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
    // Users. Before there were users the panel had one shared password: that becomes the user "beheerder".
    if (!Array.isArray(data.users)) {
        data.users = data.passwordHash ? [newUser('beheerder', 'admin', null, data.passwordHash)] : [];
        delete data.passwordHash;
        changed = true;
    }
    // First start, or a forgotten password (PANEL_PASSWORD_RESET=true): the .env password is the password of "beheerder"
    if (firstPassword && (!data.users.length || resetPassword)) {
        const admin = data.users.find((u) => u.name === 'beheerder') || data.users.find((u) => u.role === 'admin');
        if (admin) Object.assign(admin, { passwordHash: hashPassword(firstPassword), role: 'admin', sessionVersion: admin.sessionVersion + 1 });
        else data.users.push(newUser('beheerder', 'admin', firstPassword));
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
        hasUsers: () => data.users.length > 0,

        // ---------- users ----------
        // The list for the page: never the password hashes
        users: () => data.users.map(publicUser),
        user: (id) => {
            const user = data.users.find((u) => u.id === id);
            return user ? publicUser(user) : null;
        },
        sessionVersion: (id) => data.users.find((u) => u.id === id)?.sessionVersion ?? null,
        // Returns the user when name and password are right, otherwise null (always does the slow check, so the
        // answer time does not tell whether the name exists)
        checkLogin(name, password) {
            const user = data.users.find((u) => u.name === String(name || '').trim().toLowerCase());
            const ok = verifyPassword(password, user?.passwordHash || DUMMY_HASH);
            return user && ok ? publicUser(user) : null;
        },
        checkPassword(id, password) {
            const user = data.users.find((u) => u.id === id);
            return Boolean(user) && verifyPassword(password, user.passwordHash);
        },
        addUser({ name, role, password }) {
            const user = newUser(name, role, password);
            user.mustChange = true; // a password someone else chose: change it at the first login
            data.users.push(user);
            save();
            return publicUser(user);
        },
        // Own password: the other logins of this user stop working
        setUserPassword(id, password, { mustChange = false } = {}) {
            const user = data.users.find((u) => u.id === id);
            if (!user) return;
            Object.assign(user, { passwordHash: hashPassword(password), mustChange, sessionVersion: user.sessionVersion + 1 });
            save();
        },
        setRole(id, role) {
            const user = data.users.find((u) => u.id === id);
            if (!user) return;
            Object.assign(user, { role, sessionVersion: user.sessionVersion + 1 });
            save();
        },
        removeUser(id) {
            data.users = data.users.filter((u) => u.id !== id);
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

export const ROLES = ['viewer', 'staff', 'admin'];

function newUser(name, role, password, passwordHash = null) {
    return { id: crypto.randomUUID(), name, role, passwordHash: passwordHash || hashPassword(password), mustChange: false, sessionVersion: 1, createdAt: new Date().toISOString() };
}

const publicUser = ({ id, name, role, mustChange, createdAt }) => ({ id, name, role, mustChange: Boolean(mustChange), createdAt });

// Used when a name does not exist, so a wrong name takes as long as a wrong password
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString('hex'));

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
