// Who may do what. Every /api call needs a login; the user is put on req.user.
// Changes also need the header "X-Panel: 1": a browser on another website cannot send that, so no other
// site can make changes with a colleague's login (CSRF).
//
// Roles: viewer  = only look
//        staff   = also run the apps: settings (not "Voor de beheerder"), retry, restart, on/off, Exact connect
//        admin   = everything: tab Algemeen, users, the action log, apps in the panel, technical settings

const LEVEL = { viewer: 1, staff: 2, admin: 3 };

export const can = (user, role) => (LEVEL[user?.role] || 0) >= LEVEL[role];

export function currentUser(req, { sessions, store }) {
    const session = sessions.read(req);
    if (!session) return null;
    const user = store.user(session.userId);
    // A removed user, or a changed password or role, ends the login
    if (!user || store.sessionVersion(user.id) !== session.version) return null;
    return user;
}

export function panelGuard({ sessions, store }) {
    return (req, res, next) => {
        const user = currentUser(req, { sessions, store });
        if (!user) return res.status(401).json({ message: 'Log opnieuw in.' });
        if (req.method !== 'GET' && req.get('x-panel') !== '1') return res.status(403).json({ message: 'Niet toegestaan.' });
        // A password someone else chose must be changed first; until then only that is allowed
        if (user.mustChange && !(req.method === 'POST' && req.path === '/me/password')) return res.status(403).json({ message: 'Kies eerst een eigen wachtwoord.', mustChange: true });
        req.user = user;
        res.set('Cache-Control', 'no-store');
        next();
    };
}

// For one route: needs at least this role
export const need = (role) => (req, res, next) => (can(req.user, role) ? next() : res.status(403).json({ message: 'Dit mag jouw account niet. Vraag het aan een beheerder.' }));
