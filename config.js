import fs from 'node:fs';

// Load settings from the .env file (if it exists)
if (fs.existsSync('.env')) {
    process.loadEnvFile('.env');
}

const env = (name, fallback = '') => (process.env[name] || fallback).trim();

// The panel is only for the office network: the port is opened on the NAS, never in the router
export const PORT = Number(env('PORT', '8081'));

// Where the panel keeps its own data: password, session secret, the list of apps (on a Docker volume)
export const DATA_DIR = env('DATA_DIR', './data');

// The first password. After a change in the panel the new one is kept in data/panel.json (hashed).
export const FIRST_PASSWORD = env('PANEL_PASSWORD');

// Forgotten password: set to true for one start, then PANEL_PASSWORD from .env is the password again
export const RESET_PASSWORD = env('PANEL_PASSWORD_RESET') === 'true';

// The apps the panel starts with. More can be added in the panel. ADMIN_KEY = the same value as in that app's .env.
export const START_APPS = [
    { id: 'facturen', name: 'Facturen', url: env('FACTUREN_URL', 'http://factuur-app:8080'), key: env('FACTUREN_ADMIN_KEY') },
    { id: 'kasper', name: 'Kasper (chat)', url: env('KASPER_URL', 'http://casper:8090'), key: env('KASPER_ADMIN_KEY') },
].filter((app) => app.key);

// Fixed internet addresses (tab Algemeen). The API key comes from the ngrok dashboard (API Keys);
// the agent is the container nas-beheer-ngrok inside the NAS. BASE_DOMAIN is our own domain at Hostnet.
export const NGROK_API_KEY = env('NGROK_API_KEY');
export const NGROK_AGENT_URL = env('NGROK_AGENT_URL', 'http://nas-beheer-ngrok:4040');
export const BASE_DOMAIN = env('BASE_DOMAIN', 'laboratoriumdiscounter.nl');

// The updater (container nas-beheer-updater): starts new versions of the apps when a beheerder asks
export const UPDATER_URL = env('UPDATER_URL', 'http://nas-beheer-updater:8090');
export const UPDATER_KEY = env('UPDATER_KEY');

// How long a login lasts
export const SESSION_HOURS = Number(env('SESSION_HOURS', '12'));
