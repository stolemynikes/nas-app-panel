// Fixed internet addresses through ngrok, so colleagues never have to touch Docker.
// - The ngrok API (api.ngrok.com, with NGROK_API_KEY) makes an address like chat.laboratoriumdiscounter.nl
//   and tells which CNAME value has to be filled in at Hostnet.
// - The ngrok agent (the container "nas-beheer-ngrok", only inside the NAS) runs the tunnels. Its local API
//   starts a tunnel from that address to an app. Tunnels started this way are gone after a restart of the
//   agent, so the panel starts them again every few minutes (keepTunnels).

const API = 'https://api.ngrok.com';

export function createNgrok({ apiKey, agentUrl, fetchFn = fetch }) {
    async function api(method, path, body) {
        const response = await fetchFn(`${API}${path}`, {
            method,
            headers: { authorization: `Bearer ${apiKey}`, 'ngrok-version': '2', ...(body ? { 'content-type': 'application/json' } : {}) },
            body: body ? JSON.stringify(body) : undefined,
            signal: AbortSignal.timeout(15_000),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw Object.assign(new Error(data.msg || `ngrok answered ${response.status}`), { status: response.status });
        return data;
    }

    async function agent(method, path, body) {
        const response = await fetchFn(`${agentUrl}${path}`, {
            method,
            headers: body ? { 'content-type': 'application/json' } : {},
            body: body ? JSON.stringify(body) : undefined,
            signal: AbortSignal.timeout(10_000),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.msg || `ngrok agent answered ${response.status}`);
        return data;
    }

    return {
        configured: Boolean(apiKey),

        // Makes the address at ngrok (or finds it, when it was made before) and returns the CNAME value for Hostnet
        async reserveDomain(domain) {
            const existing = await this.findDomain(domain);
            if (existing) return existing;
            const made = await api('POST', '/reserved_domains', { domain, description: 'NAS Beheer' });
            return { domain: made.domain, target: made.cname_target };
        },

        async findDomain(domain) {
            const { reserved_domains: list = [] } = await api('GET', '/reserved_domains?limit=100');
            const found = list.find((d) => d.domain === domain);
            return found ? { domain: found.domain, target: found.cname_target } : null;
        },

        async agentReachable() {
            try {
                await agent('GET', '/api/tunnels');
                return true;
            } catch {
                return false;
            }
        },

        // Starts the tunnels that should run and are not running yet. Returns the names it started.
        async keepTunnels(wanted) {
            const { tunnels = [] } = await agent('GET', '/api/tunnels');
            const running = new Set(tunnels.map((t) => t.name));
            const started = [];
            for (const tunnel of wanted) {
                if (running.has(tunnel.name)) continue;
                await agent('POST', '/api/tunnels', { name: tunnel.name, proto: 'http', addr: tunnel.addr, domain: tunnel.domain });
                started.push(tunnel.name);
            }
            return started;
        },
    };
}
