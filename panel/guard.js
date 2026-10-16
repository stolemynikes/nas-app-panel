// Every /api call needs a login. Changes also need the header "X-Panel: 1": a browser on another website
// cannot send that, so no other site can make changes with a colleague's login (CSRF).
export function panelGuard(sessions) {
    return (req, res, next) => {
        if (!sessions.isLoggedIn(req)) return res.status(401).json({ message: 'Log opnieuw in.' });
        if (req.method !== 'GET' && req.get('x-panel') !== '1') return res.status(403).json({ message: 'Niet toegestaan.' });
        res.set('Cache-Control', 'no-store');
        next();
    };
}
