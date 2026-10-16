// Talks to the internal admin routes of an app (/internal/admin/...) inside the NAS.
// The admin key goes along; the app refuses everything else.

export async function callApp(app, { method = 'GET', path, body, timeoutMs = 8000, fetchFn = fetch }) {
    const response = await fetchFn(`${app.url.replace(/\/$/, '')}/internal/admin${path}`, {
        method,
        headers: { authorization: `Bearer ${app.key}`, ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    let data = null;
    try {
        data = text ? JSON.parse(text) : null;
    } catch {
        data = { message: text.slice(0, 200) };
    }
    return { status: response.status, data };
}
