import express from 'express';
import { panelGuard, need } from '../panel/guard.js';
import { ROLES } from '../panel/store.js';

// Users of the panel and the action log.
//
//   POST   /api/me/password            change your own password (everyone)
//   GET    /api/users                  all users                       (admin)
//   POST   /api/users                  add a user                      (admin)
//   PUT    /api/users/:id              change the role                 (admin)
//   POST   /api/users/:id/password     give a new temporary password   (admin)
//   DELETE /api/users/:id              remove a user                   (admin)
//   GET    /api/audit                  the action log                  (admin)

export const ROLE_NAMES = { viewer: 'Alleen kijken', staff: 'Medewerker', admin: 'Beheerder' };
const MIN_PASSWORD = 12;

export function usersRoute({ store, sessions, audit }) {
    const router = express.Router();
    router.use(express.json({ limit: '20kb' }));
    router.use(panelGuard({ sessions, store }));

    const userOr404 = (req, res) => {
        const user = store.user(req.params.id);
        if (!user) res.status(404).json({ message: 'Deze gebruiker bestaat niet (meer).' });
        return user;
    };
    const admins = () => store.users().filter((u) => u.role === 'admin').length;
    const passwordProblem = (password) => (String(password || '').length < MIN_PASSWORD ? `Kies een wachtwoord van minstens ${MIN_PASSWORD} tekens.` : '');

    router.post('/me/password', (req, res) => {
        if (!store.checkPassword(req.user.id, String(req.body?.current || ''))) return res.status(400).json({ message: 'Het huidige wachtwoord klopt niet.' });
        const next = String(req.body?.next || '');
        const problem = passwordProblem(next);
        if (problem) return res.status(400).json({ message: problem });
        if (next === req.body?.current) return res.status(400).json({ message: 'Kies een ander wachtwoord dan het huidige.' });
        store.setUserPassword(req.user.id, next);
        // This browser stays logged in with the new password; other logins of this user stop
        sessions.start(res, req.user.id, store.sessionVersion(req.user.id));
        audit.add(req.user, 'Eigen wachtwoord gewijzigd');
        res.json({ ok: true, message: 'Je wachtwoord is gewijzigd.' });
    });

    router.get('/users', need('admin'), (req, res) => res.json({ users: store.users(), roles: ROLE_NAMES, me: req.user.id }));

    router.post('/users', need('admin'), (req, res) => {
        const name = String(req.body?.name || '').trim().toLowerCase();
        const role = String(req.body?.role || '');
        if (!/^[a-z0-9][a-z0-9._-]{1,31}$/.test(name)) return res.status(400).json({ message: 'Gebruik voor de naam 2 tot 32 kleine letters, cijfers, punt, streepje of liggend streepje. Bijvoorbeeld: jan of j.devries.' });
        if (!ROLES.includes(role)) return res.status(400).json({ message: 'Kies een rol.' });
        if (store.users().some((u) => u.name === name)) return res.status(400).json({ message: 'Deze naam bestaat al.' });
        const problem = passwordProblem(req.body?.password);
        if (problem) return res.status(400).json({ message: problem });
        const user = store.addUser({ name, role, password: String(req.body.password) });
        audit.add(req.user, 'Gebruiker toegevoegd', `${name} (${ROLE_NAMES[role]})`);
        res.json({ ok: true, user });
    });

    router.put('/users/:id', need('admin'), (req, res) => {
        const user = userOr404(req, res);
        if (!user) return;
        const role = String(req.body?.role || '');
        if (!ROLES.includes(role)) return res.status(400).json({ message: 'Kies een rol.' });
        if (user.role === 'admin' && role !== 'admin' && admins() === 1) return res.status(400).json({ message: 'Er moet altijd minstens één beheerder zijn.' });
        if (role === user.role) return res.json({ ok: true });
        store.setRole(user.id, role);
        audit.add(req.user, 'Rol gewijzigd', `${user.name}: ${ROLE_NAMES[user.role]} → ${ROLE_NAMES[role]}`);
        res.json({ ok: true });
    });

    router.post('/users/:id/password', need('admin'), (req, res) => {
        const user = userOr404(req, res);
        if (!user) return;
        const problem = passwordProblem(req.body?.password);
        if (problem) return res.status(400).json({ message: problem });
        // A password someone else chose: the user has to pick an own one at the next login
        store.setUserPassword(user.id, String(req.body.password), { mustChange: user.id !== req.user.id });
        if (user.id === req.user.id) sessions.start(res, user.id, store.sessionVersion(user.id));
        audit.add(req.user, 'Wachtwoord opnieuw ingesteld', user.name);
        res.json({ ok: true, message: `Nieuw wachtwoord voor ${user.name} ingesteld. Bij het inloggen moet ${user.name} een eigen wachtwoord kiezen.` });
    });

    router.delete('/users/:id', need('admin'), (req, res) => {
        const user = userOr404(req, res);
        if (!user) return;
        if (user.id === req.user.id) return res.status(400).json({ message: 'Je kunt jezelf niet verwijderen.' });
        if (user.role === 'admin' && admins() === 1) return res.status(400).json({ message: 'Er moet altijd minstens één beheerder zijn.' });
        store.removeUser(user.id);
        audit.add(req.user, 'Gebruiker verwijderd', user.name);
        res.json({ ok: true });
    });

    router.get('/audit', need('admin'), (req, res) => {
        const user = String(req.query.user || '').slice(0, 40);
        const q = String(req.query.q || '').slice(0, 100);
        res.json({ entries: audit.read({ user, q }), users: store.users().map((u) => u.name) });
    });

    return router;
}
