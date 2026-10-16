import dns from 'node:dns/promises';

// Is a fixed address ready? 1) Hostnet points it to ngrok (CNAME), 2) it answers over https.

export async function checkAddress({ domain, target }, { resolveCname = (name) => dns.resolveCname(name), fetchFn = fetch } = {}) {
    let dnsOk = false;
    try {
        const names = await resolveCname(domain);
        const clean = (name) => String(name).toLowerCase().replace(/\.$/, '');
        dnsOk = names.map(clean).includes(clean(target));
    } catch {
        dnsOk = false;
    }
    if (!dnsOk) return { dns: false, https: false };

    try {
        // Any answer from the app is fine. ngrok itself answers with an "ngrok-error-code" when the tunnel is down.
        const response = await fetchFn(`https://${domain}/`, { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
        return { dns: true, https: !response.headers.get('ngrok-error-code') };
    } catch {
        return { dns: true, https: false };
    }
}
