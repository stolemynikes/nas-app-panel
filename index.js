import { PORT, DATA_DIR, FIRST_PASSWORD, RESET_PASSWORD, START_APPS, SESSION_HOURS, NGROK_API_KEY, NGROK_AGENT_URL, BASE_DOMAIN } from './config.js';
import { createStore } from './panel/store.js';
import { createSessions } from './panel/session.js';
import { createNgrok } from './panel/ngrok.js';
import { keepTunnels } from './routes/generalRoute.js';
import { createServer } from './server.js';

// NAS Beheer: one panel for the apps on the NAS (Facturen, Kasper, ...).
// Only for the office network: no tunnel goes here, and it needs a password.

// A first password shorter than 12 characters is not accepted
const store = createStore(DATA_DIR, { firstPassword: FIRST_PASSWORD.length >= 12 ? FIRST_PASSWORD : '', startApps: START_APPS, resetPassword: RESET_PASSWORD });
if (RESET_PASSWORD) console.log('Panel password reset to PANEL_PASSWORD from .env. Remove PANEL_PASSWORD_RESET from .env now.');
if (!store.hasPassword()) {
    console.log('Please set PANEL_PASSWORD in the .env file first (at least 12 characters)');
    process.exit(1);
}
const sessions = createSessions({ secret: () => store.sessionSecret, hours: SESSION_HOURS });
const ngrok = createNgrok({ apiKey: NGROK_API_KEY, agentUrl: NGROK_AGENT_URL });

const app = createServer({ store, sessions, ngrok, baseDomain: BASE_DOMAIN });

// The fixed addresses: their tunnels are started again when the ngrok container restarted
async function tunnels() {
    try {
        const started = await keepTunnels({ store, ngrok });
        if (started.length) console.log(`Tunnels started: ${started.join(', ')}`);
    } catch (error) {
        console.log(`Could not reach the ngrok container: ${error.message}`);
    }
}
if (ngrok.configured) {
    setTimeout(tunnels, 10_000);
    setInterval(tunnels, 5 * 60_000).unref();
}

app.listen(PORT, () => {
    console.log(`NAS Beheer is running: http://<nas>:${PORT}`);
    console.log(`Apps: ${store.apps().map((a) => a.name).join(', ') || 'none yet'}`);
    console.log(`Fixed addresses: ${ngrok.configured ? `via ngrok, under ${BASE_DOMAIN}` : 'off (no NGROK_API_KEY)'}`);
});
