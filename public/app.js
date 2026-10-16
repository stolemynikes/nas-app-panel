// NAS Beheer, the page in the browser. Plain JavaScript, no libraries.
// Everything is built with h() (textContent, never innerHTML), so text from the apps can never become code.

const state = { apps: [], tab: null, view: {}, logFilter: { level: '', app: '', q: '', tech: false } };
const main = document.getElementById('main');

// ---------- small helpers ----------

function h(tag, props = {}, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
        if (value === null || value === undefined || value === false) continue;
        if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
        else if (key === 'class') el.className = value;
        else if (key === 'text') el.textContent = value;
        else el.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat()) {
        if (child === null || child === undefined || child === false) continue;
        el.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return el;
}

function icon(level, size = '') {
    const name = { ok: 'i-ok', warn: 'i-warn', bad: 'i-bad' }[level] || 'i-info';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', `icon ${size} c-${level}`);
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `#${name}`);
    svg.append(use);
    return svg;
}

async function api(path, { method = 'GET', body } = {}) {
    const response = await fetch(path, {
        method,
        headers: { ...(method !== 'GET' ? { 'x-panel': '1' } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        credentials: 'same-origin',
    });
    if (response.status === 401 && !path.startsWith('/auth/login')) {
        showLogin();
        throw new Error('Log opnieuw in.');
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || `Er ging iets mis (${response.status}).`);
    return data;
}

const levelWord = { ok: 'in orde', warn: 'let op', bad: 'probleem' };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A button that shows "bezig..." while it works and a message after
function actionButton(label, run, { kind = '', after } = {}) {
    const message = h('span', { class: 'msg', role: 'status' });
    const button = h('button', { class: `btn ${kind}`, type: 'button' }, label);
    button.addEventListener('click', async () => {
        button.disabled = true;
        message.className = 'msg';
        message.textContent = 'Bezig…';
        try {
            const result = await run();
            message.className = 'msg ok';
            message.replaceChildren(icon('ok', 'sm'), result?.message || 'Gelukt.');
            if (after) after(result);
        } catch (error) {
            message.className = 'msg bad';
            message.replaceChildren(icon('bad', 'sm'), error.message);
        } finally {
            button.disabled = false;
        }
    });
    return [button, message];
}

// After a settings change or on/off the app restarts: wait until it answers again
async function waitForRestart(appId) {
    await wait(2500);
    for (let i = 0; i < 20; i += 1) {
        try {
            await api(`/api/apps/${appId}/status`);
            return;
        } catch {
            await wait(1500);
        }
    }
}

// ---------- login ----------

function showLogin() {
    document.getElementById('panel').hidden = true;
    document.getElementById('login').hidden = false;
    document.getElementById('password').focus();
}

document.getElementById('login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const error = document.getElementById('login-error');
    error.hidden = true;
    try {
        await api('/auth/login', { method: 'POST', body: { password: document.getElementById('password').value } });
        document.getElementById('password').value = '';
        start();
    } catch (e) {
        error.textContent = e.message;
        error.hidden = false;
    }
});

document.getElementById('logout').addEventListener('click', async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    showLogin();
});

// ---------- tabs ----------

async function loadApps() {
    const { apps } = await api('/api/apps');
    state.apps = apps;
}

function drawTabs() {
    const tabs = document.getElementById('tabs');
    const list = [
        ...state.apps.map((app) => ({ id: `app:${app.id}`, label: app.name, level: app.reachable ? app.status.level : 'bad', mode: app.reachable ? app.status.mode : null })),
        { id: 'general', label: 'Algemeen' },
        { id: 'log', label: 'Logboek' },
        { id: 'panel', label: 'Paneel' },
    ];
    if (!list.some((t) => t.id === state.tab)) state.tab = list[0].id;
    tabs.replaceChildren(
        ...list.map((tab) =>
            h('button', { class: 'tab', role: 'tab', type: 'button', 'aria-selected': String(tab.id === state.tab), onclick: () => openTab(tab.id) },
                tab.level ? h('span', { class: `dot ${tab.level}`, title: levelWord[tab.level] }) : null,
                tab.label,
                modeBadge(tab.mode)),
        ),
    );
    tabs.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function openTab(id) {
    state.tab = id;
    try {
        localStorage.setItem('nasbeheer-tab', id);
    } catch {
        // no storage: start on the first tab next time
    }
    drawTabs();
    drawMain();
}

async function drawMain() {
    if (state.tab === 'log') return drawLog();
    if (state.tab === 'panel') return drawPanel();
    if (state.tab === 'general') return drawGeneral();
    const app = state.apps.find((a) => `app:${a.id}` === state.tab);
    if (!app) return main.replaceChildren();
    const view = state.view[app.id] || 'overview';
    const seg = appHead(app, view);
    if (!app.reachable) {
        return main.replaceChildren(h('section', { class: 'card' },
            h('div', { class: 'lead' }, icon('bad', 'big'), h('div', {}, h('h2', {}, `${app.name} is niet bereikbaar`), h('p', {}, app.problem))),
            h('div', { class: 'actions' }, ...actionButton('Opnieuw kijken', async () => { await refresh(); return { message: 'Bijgewerkt.' }; }))));
    }
    if (view === 'settings') return drawSettings(app, seg);
    if (view === 'log') return drawLog(app, seg);
    return drawOverview(app, seg);
}

async function refresh() {
    await loadApps();
    drawTabs();
    drawMain();
}

// ---------- overview of one app ----------

function drawOverview(app, seg) {
    const s = app.status;
    const lead = h('section', { class: 'card' },
        h('div', { class: 'lead' }, icon(s.level, 'big'), h('div', {}, h('h2', {}, s.summary), h('p', {}, s.detail || ''))));

    const todo = h('section', { class: 'card', 'aria-labelledby': `todo-${app.id}` }, h('h3', { id: `todo-${app.id}` }, 'Moet ik iets doen?'));
    if (!s.todo?.length) {
        todo.append(h('p', { class: 'empty' }, icon('ok', 'sm'), 'Nee. Er is niets dat aandacht nodig heeft.'));
    } else {
        todo.append(h('div', { class: 'todo' }, s.todo.map((item) => todoItem(app, item))));
    }

    const checks = h('section', { class: 'card' }, h('h3', {}, 'Werkt alles?'),
        h('ul', { class: 'checks' }, (s.checks || []).map((c) =>
            h('li', {}, icon(c.level), h('div', {}, h('strong', {}, c.label), h('span', {}, c.detail || ''))))));

    main.replaceChildren(seg, lead, todo, checks, onOffCard(app), restartCard(app));
}

function todoItem(app, item) {
    const box = h('div', { class: `todo-item ${item.level === 'warn' ? 'warn' : ''}` },
        h('strong', {}, item.title),
        item.why ? h('p', {}, item.why) : null,
        item.how ? h('p', { class: 'how' }, item.how) : null);
    if (item.action) {
        if (item.action.id === 'exact-connect') box.append(connectExact(app, item.action.label));
        else box.append(h('div', { class: 'actions' }, ...actionButton(item.action.label, () =>
            api(`/api/apps/${app.id}/actions/${item.action.id}`, { method: 'POST', body: item.action.body || {} }),
            { after: () => setTimeout(refresh, 4000) })));
    }
    return box;
}

// Connecting Exact again: 1) open the login address, 2) paste the address the browser lands on
function connectExact(app, label) {
    const box = h('div', { class: 'connect' });
    const [start, startMessage] = actionButton(label, async () => {
        const result = await api(`/api/apps/${app.id}/actions/exact-connect`, { method: 'POST' });
        const input = h('input', { type: 'url', id: `code-${app.id}`, placeholder: 'Plak hier het hele adres', autocomplete: 'off' });
        box.replaceChildren(
            h('p', {}, result.message),
            h('p', {}, h('a', { href: result.url, target: '_blank', rel: 'noopener noreferrer', class: 'btn primary' }, 'Inloggen bij Exact')),
            h('div', { class: 'field' }, h('label', { for: `code-${app.id}` }, 'Adres na het inloggen'), input),
            h('div', { class: 'actions' }, ...actionButton('Koppelen', () =>
                api(`/api/apps/${app.id}/actions/exact-code`, { method: 'POST', body: { url: input.value } }),
                { kind: 'primary', after: () => setTimeout(refresh, 3000) })));
        return { message: '' };
    });
    box.append(h('div', { class: 'actions' }, start, startMessage));
    return box;
}

function onOffCard(app) {
    const s = app.status;
    const o = s.onoff || { label: app.name, on: 'Aan', off: 'Uit', confirmOff: 'Weet je het zeker?' };
    const card = h('section', { class: 'card' });
    const draw = (confirming) => {
        const line = h('div', { class: 'onoff' },
            h('div', {}, h('h3', {}, o.label),
                h('p', { class: 'status-line' }, h('span', { class: 'state' }, icon(s.enabled ? 'ok' : 'warn', 'sm'), s.enabled ? o.on : o.off))),
            confirming ? null : h('div', { class: 'actions' }, s.enabled
                ? h('button', { class: 'btn', type: 'button', onclick: () => draw(true) }, 'Uitzetten')
                : actionButton('Aanzetten', () => switchApp(app, true), { kind: 'primary' })));
        const parts = [line];
        if (confirming) {
            parts.push(h('div', { class: 'confirm', role: 'alertdialog', 'aria-label': 'Bevestigen' },
                h('p', {}, h('strong', {}, `${o.label} uitzetten?`), ' ', o.confirmOff),
                h('div', { class: 'actions' },
                    ...actionButton('Ja, zet uit', () => switchApp(app, false), { kind: 'danger' }),
                    h('button', { class: 'btn', type: 'button', onclick: () => draw(false) }, 'Annuleren'))));
        }
        card.replaceChildren(...parts);
    };
    draw(false);
    return card;
}

async function switchApp(app, enabled) {
    await api(`/api/apps/${app.id}/enabled`, { method: 'POST', body: { enabled } });
    await waitForRestart(app.id);
    await refresh();
    return { message: enabled ? 'Aangezet.' : 'Uitgezet.' };
}

// ---------- settings of one app: every setting is a plain question ----------

const modeBadge = (mode) => (mode ? h('span', { class: `mode ${mode}` }, mode === 'live' ? 'LIVE' : 'TEST') : null);

// The answer as people read it, e.g. "Alleen testorders" or "info@laboratoriumdiscounter.nl"
function answerText(field, value) {
    if (field.choices) return field.choices.find((c) => c.value === value)?.title || value;
    if (field.type === 'secret') return value ? 'nieuwe sleutel' : 'ingesteld';
    return value || field.empty || 'leeg';
}

async function drawSettings(app, head) {
    main.replaceChildren(head, h('section', { class: 'card' }, h('p', { class: 'muted-line' }, 'Instellingen laden…')));
    let fields;
    try {
        ({ fields } = await api(`/api/apps/${app.id}/settings`));
    } catch (error) {
        return main.replaceChildren(head, h('section', { class: 'card' }, h('p', { class: 'error' }, error.message)));
    }
    // Shared settings (webshop, contact address) are set in the tab Algemeen
    fields = fields.filter((f) => !f.shared);

    const chosen = new Map(fields.map((f) => [f.key, f.type === 'secret' ? '' : String(f.value ?? '')]));
    const original = new Map(chosen);
    const cards = new Map();
    const bar = h('div', { class: 'bar', hidden: true });
    let confirming = false;

    const changed = () => fields.filter((f) => chosen.get(f.key) !== original.get(f.key));

    function questionCard(f) {
        const id = `f-${app.id}-${f.key}`;
        const now = h('span', { class: 'now' });
        const card = h('section', { class: 'card' }, h('div', { class: 'q-head' }, h('h3', {}, f.label), now));
        if (f.choices) {
            const group = h('div', { class: 'choices', role: 'radiogroup', 'aria-label': f.label });
            for (const c of f.choices) {
                const input = h('input', { type: 'radio', name: id, id: `${id}-${c.value}`, value: c.value, checked: c.value === chosen.get(f.key) });
                input.addEventListener('change', () => { chosen.set(f.key, c.value); update(); });
                group.append(h('label', { class: 'choice', for: `${id}-${c.value}` }, input, modeBadge(c.mode), h('strong', {}, c.title), h('span', {}, c.text)));
            }
            card.append(group);
        } else {
            const type = { email: 'email', number: 'number', date: 'date', secret: 'password' }[f.type] || 'text';
            const input = h('input', { type, id, value: f.type === 'secret' ? '' : f.value ?? '', placeholder: f.type === 'secret' ? (f.isSet ? 'Ingesteld · leeg laten = niet veranderen' : 'Nog niet ingesteld') : f.placeholder || null, autocomplete: f.type === 'secret' ? 'new-password' : 'off', min: f.type === 'number' ? '1' : null });
            input.addEventListener('input', () => { chosen.set(f.key, input.value.trim()); update(); });
            card.append(h('div', { class: 'field' }, h('label', { for: id, class: 'sr-only' }, f.label), input, f.help ? h('small', {}, f.help) : null));
        }
        if (f.choices && f.help) card.append(h('p', { class: 'muted-line' }, f.help));
        cards.set(f.key, { card, now, f });
        return card;
    }

    function update() {
        for (const { card, now, f } of cards.values()) {
            const isChanged = chosen.get(f.key) !== original.get(f.key);
            card.classList.toggle('changed', isChanged);
            now.replaceChildren(isChanged ? h('span', { class: 'badge-changed' }, 'Gewijzigd, nog niet opgeslagen') : f.type === 'secret' ? '' : h('span', {}, 'Nu: ', h('b', {}, answerText(f, original.get(f.key)))));
        }
        confirming = false;
        drawBar();
    }

    function drawBar(done) {
        const list = changed();
        if (done) {
            bar.hidden = false;
            return bar.replaceChildren(h('div', { class: 'bar-in' }, h('p', { class: 'msg ok' }, icon('ok', 'sm'), done)));
        }
        if (!list.length) { bar.hidden = true; return; }
        bar.hidden = false;
        const risky = list.map((f) => f.choices?.find((c) => c.value === chosen.get(f.key))?.risky).filter(Boolean);
        const lines = h('ul', {}, list.map((f) => h('li', {}, `${f.label} `, f.type === 'secret' ? h('b', {}, 'nieuwe sleutel') : [h('b', {}, answerText(f, original.get(f.key))), ' → ', h('b', {}, answerText(f, chosen.get(f.key)))])));
        const undo = h('button', { class: 'btn', type: 'button', onclick: () => drawSettings(app, head) }, 'Ongedaan maken');
        if (!confirming) {
            bar.replaceChildren(h('div', { class: 'bar-in' },
                h('p', {}, h('b', {}, list.length === 1 ? '1 wijziging' : `${list.length} wijzigingen`), ' (nog niet opgeslagen)'), lines,
                h('div', { class: 'actions end' }, undo, h('button', { class: 'btn primary', type: 'button', onclick: () => { confirming = true; drawBar(); } }, 'Opslaan'))));
            return;
        }
        const [yes, message] = actionButton(risky.length ? 'Ja, ik weet het zeker' : 'Ja, opslaan', async () => {
            const values = Object.fromEntries(list.map((f) => [f.key, chosen.get(f.key)]));
            await api(`/api/apps/${app.id}/settings`, { method: 'PUT', body: { values } });
            bar.replaceChildren(h('div', { class: 'bar-in' }, h('p', { class: 'muted-line' }, `${app.name} start opnieuw… even geduld.`)));
            await waitForRestart(app.id);
            await loadApps();
            drawTabs();
            await drawSettings(app, appHead(state.apps.find((a) => a.id === app.id) || app, 'settings'));
            return { message: 'Opgeslagen.' };
        }, { kind: risky.length ? 'danger' : 'primary' });
        bar.replaceChildren(h('div', { class: 'bar-in' }, lines,
            h('div', { class: risky.length ? 'confirm' : 'confirm calm' },
                h('p', {}, risky.length ? [h('b', {}, 'Let op. '), risky.join(' '), ' '] : '', `${app.name} start daarna even opnieuw (een paar seconden).`),
                h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', onclick: () => { confirming = false; drawBar(); } }, 'Terug'), yes, message))));
    }

    // Groups: normal questions first, "Voor de beheerder" folded away
    const groups = [];
    for (const f of fields) {
        let group = groups.find((g) => g.name === (f.group || 'Instellingen'));
        if (!group) groups.push((group = { name: f.group || 'Instellingen', advanced: Boolean(f.advanced), fields: [] }));
        group.fields.push(f);
    }
    const parts = [h('p', { class: 'intro' }, `Hier bepaal je hoe ${app.name} werkt. Kies bij elke vraag een antwoord. Wat je verandert, zie je onderaan staan; er gebeurt pas iets als je op Opslaan klikt.`)];
    for (const g of groups.filter((x) => !x.advanced)) parts.push(h('p', { class: 'group-title' }, g.name), ...g.fields.map(questionCard));

    const connections = app.status.connections || [];
    if (connections.length) parts.push(h('p', { class: 'group-title' }, 'Koppelingen'), ...connections.map((c) => connectionCard(app, c)));

    for (const g of groups.filter((x) => x.advanced)) {
        parts.push(h('details', { class: 'card' }, h('summary', {}, `${g.name}: technische instellingen`),
            h('p', { class: 'muted-line' }, `Verander deze alleen als de beheerder erom vraagt. Een fout hier kan ${app.name} laten stoppen.`),
            h('div', { class: 'stack' }, g.fields.map(questionCard))));
    }

    main.replaceChildren(head, ...parts, bar);
    update();
}

function connectionCard(app, c) {
    const card = h('section', { class: 'card' },
        h('div', { class: 'q-head' }, h('h3', {}, c.title, ' ', modeBadge(c.mode)), h('span', { class: 'now' }, 'Nu: ', h('b', { class: `c-${c.level === 'bad' ? 'bad' : c.level === 'warn' ? 'warn' : 'ok'}` }, c.state))),
        h('p', { class: 'muted-line' }, c.text),
        c.note ? h('p', { class: 'muted-line' }, c.note) : null);
    if (c.action?.id === 'exact-connect') card.append(connectExact(app, c.action.label));
    if (c.general) card.append(h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', onclick: () => openTab('general') }, 'Naar Algemeen')));
    return card;
}

// TEST or LIVE strip at the top of every app page
function modeStrip(app) {
    const s = app.status;
    if (!s?.mode) return null;
    return h('div', { class: `strip ${s.mode}` }, modeBadge(s.mode), h('p', {}, s.modeText || ''));
}

function appHead(app, view) {
    const go = (v) => () => { state.view[app.id] = v; drawMain(); };
    return h('div', { class: 'app-head' },
        h('div', { class: 'seg', role: 'group', 'aria-label': 'Weergave' },
            h('button', { type: 'button', 'aria-pressed': String(view === 'overview'), onclick: go('overview') }, 'Overzicht'),
            h('button', { type: 'button', 'aria-pressed': String(view === 'settings'), onclick: go('settings') }, 'Instellingen'),
            h('button', { type: 'button', 'aria-pressed': String(view === 'log'), onclick: go('log') }, 'Logboek')),
        modeStrip(app));
}

// Restart: confirm, then wait until the app answers again
function restartCard(app) {
    const card = h('section', { class: 'card' });
    const draw = (confirming) => {
        const parts = [h('h3', {}, 'App opnieuw starten'),
            h('p', { class: 'muted-line' }, `Helpt als ${app.name} vastzit of vreemd doet. Het duurt een paar seconden en er gaat niets verloren.`)];
        if (!confirming) parts.push(h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', onclick: () => draw(true) }, 'Opnieuw starten')));
        else {
            const [yes, message] = actionButton('Ja, opnieuw starten', async () => {
                await api(`/api/apps/${app.id}/restart`, { method: 'POST' });
                await waitForRestart(app.id);
                setTimeout(refresh, 1500);
                return { message: `${app.name} draait weer.` };
            }, { kind: 'primary' });
            parts.push(h('div', { class: 'confirm calm' }, h('p', {}, `${app.name} een paar seconden stoppen en weer starten?`),
                h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', onclick: () => draw(false) }, 'Annuleren'), yes, message)));
        }
        parts.push(h('p', { class: 'muted-line small' }, 'Antwoordt de app helemaal niet meer? Dan werkt deze knop niet. Herstart hem dan in Container Manager → Project → ',
            h('b', {}, app.status?.container || app.id), ' → Actie → Opnieuw opstarten.'));
        card.replaceChildren(...parts);
    };
    draw(false);
    return card;
}

// ---------- tab Algemeen: the same for all apps ----------

async function drawGeneral() {
    main.replaceChildren(h('section', { class: 'card' }, h('p', { class: 'muted-line' }, 'Laden…')));
    let g;
    try {
        g = await api('/api/general');
    } catch (error) {
        return main.replaceChildren(h('section', { class: 'card' }, h('p', { class: 'error' }, error.message)));
    }
    const parts = [h('p', { class: 'intro' }, 'Instellingen die voor alle apps gelden. Wat je hier verandert, zet het paneel bij elke app die het gebruikt.')];
    if (g.missing.length) parts.push(h('p', { class: 'msg bad' }, icon('warn', 'sm'), `Niet bereikbaar: ${g.missing.join(', ')}. Die apps worden hier overgeslagen.`));

    // Test or live
    parts.push(h('p', { class: 'group-title' }, 'Hoe draait alles?'), h('section', { class: 'card' },
        h('h3', {}, 'Test of live'),
        h('ul', { class: 'modes' }, g.testLive.map((p) => h('li', {}, modeBadge(p.mode),
            h('div', { class: 'row' }, h('div', {}, h('b', {}, p.label), h('span', {}, p.text)),
                p.appId ? h('button', { class: 'btn small', type: 'button', onclick: () => { state.view[p.appId] = 'settings'; openTab(`app:${p.appId}`); } }, 'Naar instellingen')
                    : p.id === 'webshop' ? h('button', { class: 'btn small', type: 'button', onclick: () => document.getElementById('webshop')?.scrollIntoView({ behavior: 'smooth' }) }, 'Naar webshop') : null)))),
        h('p', { class: 'muted-line small' }, 'Omzetten naar live doe je per app, bij die app onder Instellingen. Zo gaat er nooit per ongeluk alles tegelijk live.')));

    parts.push(h('p', { class: 'group-title' }, 'Gedeeld door de apps'), webshopCard(g), addressesCard(g), contactCard(g));
    main.replaceChildren(...parts);
}

function webshopCard(g) {
    const shop = g.shared.shopDomain;
    const card = h('section', { class: 'card', id: 'webshop' });
    const flow = h('div', { class: 'stack' });
    const startButton = h('button', { class: 'btn', type: 'button' }, 'Andere webshop koppelen');
    startButton.addEventListener('click', () => {
        const input = h('input', { type: 'text', id: 'shop-domain', placeholder: 'bijvoorbeeld laboratoriumdiscounter.myshopify.com', autocomplete: 'off' });
        const result = h('div', { class: 'stack' });
        const [test, testMessage] = actionButton('Verbinding testen', async () => {
            const r = await api('/api/general/shop-test', { method: 'POST', body: { domain: input.value } });
            const [save, saveMessage] = actionButton('Ja, koppel deze webshop', async () => {
                const saved = await api('/api/general/shared', { method: 'PUT', body: { name: 'shopDomain', value: r.domain } });
                if (!saved.ok) throw new Error(saved.results.filter((x) => !x.ok).map((x) => `${x.name}: ${x.message}`).join(' '));
                await wait(4000);
                await refresh();
                return { message: 'Gekoppeld. De apps zijn opnieuw gestart.' };
            }, { kind: 'danger' });
            result.replaceChildren(
                h('ul', { class: 'modes compact' }, r.results.map((x) => h('li', {}, icon(x.ok ? 'ok' : 'bad', 'sm'), h('div', {}, h('b', {}, x.name), h('span', {}, x.message))))),
                r.ok
                    ? h('div', { class: 'confirm' }, h('p', {}, h('b', {}, 'Let op: vanaf nu kijken alle apps naar deze webshop. '), 'Kijk eerst bij Facturen naar "Wie krijgen er een factuur?" en de startdatum, anders krijgen ook oude orders een factuur. Doe dit alleen samen met de beheerder.'),
                        h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', onclick: drawGeneral }, 'Annuleren'), save, saveMessage))
                    : h('p', { class: 'muted-line' }, 'Niet alle apps kunnen deze webshop lezen, dus er is niets veranderd. Kreeg je bij het installeren nieuwe sleutels? Zet die eerst bij elke app onder Instellingen → "Voor de beheerder".'));
            return { message: r.ok ? 'Alle apps kunnen deze webshop lezen.' : 'Niet gelukt.' };
        }, { kind: 'primary' });
        flow.replaceChildren(
            h('div', { class: 'field' }, h('label', { for: 'shop-domain' }, 'Adres van de webshop in Shopify'), input,
                h('small', {}, 'Het adres dat eindigt op .myshopify.com. Je vindt het in Shopify bij Instellingen → Domeinen. De Shopify-apps moeten eerst op die webshop geïnstalleerd zijn.')),
            h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', onclick: drawGeneral }, 'Annuleren'), test, testMessage),
            result);
        input.focus();
    });
    flow.append(h('div', { class: 'actions' }, startButton));
    const testStore = shop.value === 'hevjuq-bg.myshopify.com';
    card.append(
        h('div', { class: 'q-head' }, h('h3', {}, 'Webshop (Shopify) ', modeBadge(shop.value ? (testStore ? 'test' : 'live') : null)), h('span', { class: 'now' }, 'Nu: ', h('b', {}, shop.value || 'niet ingesteld'))),
        h('ul', { class: 'modes compact' }, shop.apps.map((a) => h('li', {}, icon(a.level === 'bad' ? 'bad' : a.level === 'warn' ? 'warn' : 'ok', 'sm'),
            h('div', {}, h('b', {}, a.name), h('span', {}, a.value === shop.value ? 'gebruikt deze webshop' : `gebruikt ${a.value || 'geen webshop'}`))))),
        h('p', { class: 'muted-line' }, 'Een andere webshop koppelen doe je bij de overstap van de testwinkel naar de echte webshop.'),
        flow);
    return card;
}

function contactCard(g) {
    const contact = g.shared.contactEmail;
    const input = h('input', { type: 'email', id: 'contact-email', value: contact.value, autocomplete: 'off' });
    const [save, message] = actionButton('Opslaan voor alle apps', async () => {
        const r = await api('/api/general/shared', { method: 'PUT', body: { name: 'contactEmail', value: input.value } });
        if (!r.ok) throw new Error(r.results.filter((x) => !x.ok).map((x) => `${x.name}: ${x.message}`).join(' '));
        await wait(4000);
        return { message: `Opgeslagen bij ${r.results.map((x) => x.name).join(' en ')}. De apps zijn even opnieuw gestart.` };
    }, { kind: 'primary' });
    return h('section', { class: 'card' },
        h('div', { class: 'q-head' }, h('h3', {}, 'Contactadres van de winkel'), h('span', { class: 'now' }, 'Nu: ', h('b', {}, contact.value || 'niet ingesteld'))),
        h('p', { class: 'muted-line' }, 'Facturen noemt dit adres in de factuurmail. Kasper stuurt hier de vragen heen die hij zelf niet kan beantwoorden.'),
        h('div', { class: 'field' }, h('label', { for: 'contact-email', class: 'sr-only' }, 'Contactadres'), input),
        h('div', { class: 'actions' }, save, message));
}

// ---------- fixed internet addresses (ngrok + Hostnet) ----------

function addressesCard(g) {
    const a = g.addresses;
    const card = h('section', { class: 'card' }, h('h3', {}, 'Vaste internetadressen'),
        h('p', { class: 'muted-line' }, 'Via deze adressen bereikt de webshop de apps op de NAS: de factuurknop in het klantaccount en de chat. Een tijdelijk adres verandert bij elke herstart van de NAS; een vast adres blijft altijd hetzelfde.'));
    if (!a.configured) {
        card.append(h('div', { class: 'confirm calm' }, h('p', {}, h('b', {}, 'Nog niet ingesteld. '), 'De beheerder moet eerst één keer een ngrok-account koppelen (zie de handleiding, "Vaste adressen"). Daarna kun je hier zelf vaste adressen maken.')));
        return card;
    }
    card.append(h('p', { class: 'muted-line small' }, a.agent ? [h('span', { class: 'c-ok' }, '✓ '), 'ngrok-account gekoppeld. Hiermee maakt het paneel de vaste adressen.'] : [h('span', { class: 'c-warn' }, '! '), 'De ngrok-container antwoordt niet. Staat het project nas-beheer helemaal aan?']));
    const flow = h('div', { class: 'stack' });
    card.append(h('ul', { class: 'modes' }, a.list.map((x) => h('li', {}, h('span', { class: `mode ${x.active ? 'live' : 'test'}` }, x.active ? 'VAST' : 'TIJDELIJK'),
        h('div', { class: 'row' },
            h('div', {}, h('b', {}, x.name), h('span', {}, x.active ? `https://${x.domain}` : x.domain ? `${x.domain} · nog niet klaar` : 'Nu een tijdelijk adres.')),
            h('button', { class: 'btn small', type: 'button', onclick: () => addressWizard(flow, a, x, x.active ? 4 : x.domain ? 2 : 1) }, x.active ? 'Bekijken' : x.domain ? 'Verder' : 'Vast adres instellen'))))), flow);
    return card;
}

function copyButton(text) {
    const button = h('button', { class: 'btn small', type: 'button' }, 'Kopiëren');
    button.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(text);
            button.textContent = 'Gekopieerd';
        } catch {
            button.textContent = 'Selecteer en kopieer zelf';
        }
        setTimeout(() => { button.textContent = 'Kopiëren'; }, 2000);
    });
    return button;
}

function addressWizard(flow, a, x, step) {
    const steps = ['Adres kiezen', 'Bij Hostnet invullen', 'Controleren', 'Klaar'];
    const box = h('div', { class: 'connect' }, h('h3', {}, `Vast adres voor ${x.name}`),
        h('ol', { class: 'steps' }, steps.map((s, i) => h('li', { class: i + 1 < step ? 'done-step' : i + 1 === step ? 'now-step' : '' }, s))));
    const close = h('button', { class: 'btn', type: 'button', onclick: () => flow.replaceChildren() }, step === 4 ? 'Sluiten' : 'Later verder');

    if (step === 1) {
        const suggestion = x.appId === 'kasper' ? 'chat' : x.appId;
        const input = h('input', { type: 'text', id: `addr-${x.appId}`, value: suggestion, autocomplete: 'off' });
        const [make, message] = actionButton('Adres aanmaken', async () => {
            const r = await api(`/api/addresses/${x.appId}/reserve`, { method: 'POST', body: { name: input.value } });
            addressWizard(flow, a, { ...x, domain: r.domain, target: r.target }, 2);
            return { message: '' };
        }, { kind: 'primary' });
        box.append(
            h('p', {}, 'Kies hoe het adres begint.'),
            h('div', { class: 'field' }, h('label', { for: input.id }, 'Begin van het adres'),
                h('div', { class: 'addr-input' }, input, h('span', {}, `.${a.baseDomain}`)),
                h('small', {}, 'Alleen kleine letters, cijfers en een streepje. Bijvoorbeeld chat of facturen.')),
            h('div', { class: 'actions' }, close, make, message));
    }
    if (step === 2) {
        const name = x.domain.slice(0, -(a.baseDomain.length + 1));
        box.append(
            h('p', { class: 'msg ok' }, icon('ok', 'sm'), `${x.domain} is aangemaakt.`),
            h('p', {}, 'Nu moet er één regel bij Hostnet komen, waar ons domein staat. Doe dit zo:'),
            h('ol', { class: 'plain' },
                h('li', {}, 'Log in op ', h('b', {}, 'mijn.hostnet.nl'), '.'),
                h('li', {}, 'Ga naar ', h('b', {}, 'Domeinnamen'), ' → ', h('b', {}, a.baseDomain), ' → ', h('b', {}, 'DNS-instellingen'), '.'),
                h('li', {}, 'Klik op ', h('b', {}, 'Record toevoegen'), ' en neem deze drie dingen over:')),
            h('div', { class: 'dns-rows' },
                h('span', {}, 'Type'), h('code', {}, 'CNAME'), h('span', {}),
                h('span', {}, 'Naam'), h('code', {}, name), copyButton(name),
                h('span', {}, 'Waarde'), h('code', {}, x.target), copyButton(x.target)),
            h('p', { class: 'muted-line small' }, 'Laat de andere velden zoals ze zijn en sla op. De namen in het scherm van Hostnet kunnen iets anders zijn.'),
            h('div', { class: 'actions' }, close, h('button', { class: 'btn primary', type: 'button', onclick: () => addressWizard(flow, a, x, 3) }, 'Ik heb het ingevuld')));
    }
    if (step === 3) {
        const result = h('div', { class: 'stack' });
        const [check, message] = actionButton('Controleren', async () => {
            const r = await api(`/api/addresses/${x.appId}/check`, { method: 'POST' });
            const rows = h('ul', { class: 'modes compact' },
                h('li', {}, icon(r.dns ? 'ok' : 'warn', 'sm'), h('div', {}, h('b', {}, r.dns ? 'Gevonden bij Hostnet' : 'Nog niet gevonden bij Hostnet'), h('span', {}, r.dns ? `${x.domain} wijst naar ngrok.` : 'Dat is normaal vlak na het invullen: het kan tot een paar uur duren. Klopt de regel bij Hostnet? Wacht dan even en controleer opnieuw.'))),
                r.dns ? h('li', {}, icon(r.https ? 'ok' : 'warn', 'sm'), h('div', {}, h('b', {}, r.https ? 'Beveiligd (https) en bereikbaar' : 'Nog niet bereikbaar'), h('span', {}, r.https ? 'Het adres werkt.' : 'Het beveiligde certificaat wordt nog gemaakt, of de app staat uit. Probeer het over een paar minuten opnieuw.'))) : null);
            const parts = [rows];
            if (r.dns && r.https) {
                parts.push(h('div', { class: 'actions' }, ...actionButton(`Gebruiken voor ${x.name}`, async () => {
                    await api(`/api/addresses/${x.appId}/use`, { method: 'POST' });
                    addressWizard(flow, a, { ...x, active: true }, 4);
                    return { message: '' };
                }, { kind: 'primary' })));
            }
            result.replaceChildren(...parts);
            return { message: r.dns && r.https ? 'Klaar.' : 'Nog niet klaar.' };
        }, { kind: 'primary' });
        box.append(h('p', {}, `Het paneel kijkt of ${x.domain} al werkt.`), h('div', { class: 'actions' }, close, check, message), result);
    }
    if (step === 4) {
        box.append(h('p', { class: 'msg ok' }, icon('ok', 'sm'), `${x.name} is bereikbaar via https://${x.domain}`),
            h('div', { class: 'confirm calm' }, h('p', {}, h('b', {}, 'Nog één keer door de beheerder: '),
                x.appId === 'kasper' ? 'het chat-script in het thema van de webshop moet naar dit adres wijzen.' : 'de factuurknop in de webshop moet dit adres krijgen (Shopify-extensies bijwerken).',
                ' Daarna hoeft dat nooit meer, want het adres blijft hetzelfde.')),
            h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', onclick: drawGeneral }, 'Sluiten')));
    }
    flow.replaceChildren(box);
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}


// ---------- logbook ----------

// The logbook of all apps (tab Logboek), or of one app (app given: the app's own Logboek view)
async function drawLog(app = null, seg = null) {
    const f = state.logFilter;
    const levelSelect = h('select', { id: 'log-level' },
        [['', 'Alles'], ['problems', 'Alleen problemen'], ['bad', 'Fouten'], ['warn', 'Let op'], ['ok', 'In orde']].map(([value, label]) => h('option', { value, selected: value === f.level }, label)));
    const appSelect = h('select', { id: 'log-app' },
        h('option', { value: '' }, 'Alle apps'), state.apps.map((a) => h('option', { value: a.id, selected: a.id === (app ? app.id : f.app) }, a.name)));
    const search = h('input', { type: 'search', id: 'log-q', value: f.q, placeholder: 'Bijvoorbeeld een ordernummer' });
    const tech = h('input', { type: 'checkbox', id: 'log-tech', checked: f.tech });
    const list = h('ul', { class: app ? 'log one-app' : 'log' });
    const note = h('p', { class: 'muted-line', role: 'status' }, 'Laden…');

    const load = async () => {
        Object.assign(f, { level: levelSelect.value, q: search.value.trim(), tech: tech.checked }, app ? {} : { app: appSelect.value });
        note.textContent = 'Laden…';
        try {
            const params = new URLSearchParams({ level: f.level, app: app ? app.id : f.app, q: f.q });
            const { entries, missing } = await api(`/api/log?${params}`);
            list.replaceChildren(...entries.map((e) => logLine(e, f.tech, !app)));
            note.textContent = [
                entries.length ? `${entries.length} regels, nieuwste bovenaan.` : 'Geen regels gevonden.',
                missing.length ? `Niet bereikbaar: ${missing.join(', ')}.` : '',
            ].join(' ');
        } catch (error) {
            note.textContent = error.message;
        }
    };
    let timer;
    search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 300); });
    for (const el of [levelSelect, appSelect, tech]) el.addEventListener('change', load);

    main.replaceChildren(...(seg ? [seg] : []), h('section', { class: 'card' },
        h('div', { class: 'filters' },
            h('div', { class: 'field' }, h('label', { for: 'log-level' }, 'Toon'), levelSelect),
            app ? null : h('div', { class: 'field' }, h('label', { for: 'log-app' }, 'App'), appSelect),
            h('div', { class: 'field grow' }, h('label', { for: 'log-q' }, 'Zoeken'), search)),
        h('label', { class: 'check', for: 'log-tech' }, tech, h('span', {}, 'Technische details tonen')),
        note,
        list));
    load();
}

function logLine(entry, showTech, showApp = true) {
    const when = new Date(entry.time);
    const time = when.toLocaleString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const text = entry.plain || entry.tech;
    return h('li', {},
        icon(entry.level),
        h('time', { datetime: entry.time }, time),
        showApp ? h('span', { class: 'tag' }, entry.app) : null,
        h('div', {}, text, showTech && entry.plain ? h('span', { class: 'tech' }, entry.tech) : null));
}

// ---------- the panel itself: apps and password ----------

function drawPanel() {
    const appsCard = h('section', { class: 'card' }, h('h3', {}, 'Apps in het paneel'),
        h('ul', { class: 'checks' }, state.apps.map((app) =>
            h('li', {}, icon(app.reachable ? 'ok' : 'bad'),
                h('div', { class: 'onoff' },
                    h('div', {}, h('strong', {}, app.name), h('span', { class: 'mono' }, app.url)),
                    removeButton(app))))));

    const name = h('input', { id: 'add-name', required: true, maxlength: '60' });
    const url = h('input', { id: 'add-url', required: true, placeholder: 'http://naam-van-de-container:8080' });
    const key = h('input', { id: 'add-key', type: 'password', required: true, autocomplete: 'off' });
    const [add, addMessage] = actionButton('App toevoegen', async () => {
        await api('/api/apps', { method: 'POST', body: { name: name.value, url: url.value, key: key.value } });
        key.value = '';
        await refresh();
        return { message: 'Toegevoegd.' };
    }, { kind: 'primary' });
    const addCard = h('section', { class: 'card' }, h('h3', {}, 'App toevoegen'),
        h('p', { class: 'muted-line' }, 'De app moet in het Docker-netwerk nas-apps zitten en een ADMIN_KEY hebben (zie de handleiding).'),
        h('div', { class: 'field' }, h('label', { for: 'add-name' }, 'Naam'), name),
        h('div', { class: 'field' }, h('label', { for: 'add-url' }, 'Adres binnen de NAS'), url),
        h('div', { class: 'field' }, h('label', { for: 'add-key' }, 'Beheersleutel (ADMIN_KEY van die app)'), key),
        h('div', { class: 'actions' }, add, addMessage));

    const current = h('input', { id: 'pw-current', type: 'password', autocomplete: 'current-password' });
    const next = h('input', { id: 'pw-next', type: 'password', autocomplete: 'new-password', minlength: '12' });
    const [change, changeMessage] = actionButton('Wachtwoord wijzigen', async () => {
        const result = await api('/api/password', { method: 'POST', body: { current: current.value, next: next.value } });
        current.value = '';
        next.value = '';
        return { ...result, message: 'Gewijzigd. Vertel het nieuwe wachtwoord aan je collega\'s.' };
    }, { kind: 'primary' });
    const passwordCard = h('section', { class: 'card' }, h('h3', {}, 'Wachtwoord van het paneel'),
        h('div', { class: 'field' }, h('label', { for: 'pw-current' }, 'Huidig wachtwoord'), current),
        h('div', { class: 'field' }, h('label', { for: 'pw-next' }, 'Nieuw wachtwoord'), next, h('small', {}, 'Minstens 12 tekens.')),
        h('div', { class: 'actions' }, change, changeMessage));

    main.replaceChildren(appsCard, addCard, passwordCard);
}

function removeButton(app) {
    const box = h('div', { class: 'actions' });
    const ask = () => box.replaceChildren(
        h('span', {}, 'Uit het paneel halen? De app zelf blijft draaien.'),
        ...actionButton('Ja, weghalen', async () => {
            await api(`/api/apps/${app.id}`, { method: 'DELETE' });
            await refresh();
            return { message: 'Weggehaald.' };
        }, { kind: 'danger' }),
        h('button', { class: 'btn', type: 'button', onclick: () => box.replaceChildren(h('button', { class: 'btn', type: 'button', onclick: ask }, 'Weghalen')) }, 'Annuleren'));
    box.append(h('button', { class: 'btn', type: 'button', onclick: ask }, 'Weghalen'));
    return box;
}

// ---------- start ----------

async function start() {
    const { loggedIn } = await api('/auth/session').catch(() => ({ loggedIn: false }));
    if (!loggedIn) return showLogin();
    document.getElementById('login').hidden = true;
    document.getElementById('panel').hidden = false;
    try {
        state.tab = localStorage.getItem('nasbeheer-tab');
    } catch {
        state.tab = null;
    }
    // A bookmark like #logboek, #paneel, #facturen, #facturen-instellingen or #facturen-logboek opens that screen
    const hash = location.hash.slice(1);
    if (hash === 'logboek') state.tab = 'log';
    else if (hash === 'paneel') state.tab = 'panel';
    else if (hash === 'algemeen') state.tab = 'general';
    else if (/^[a-z0-9-]+$/.test(hash)) {
        const match = hash.match(/^(.+?)(?:-(instellingen|logboek))?$/);
        state.tab = `app:${match[1]}`;
        state.view[match[1]] = { instellingen: 'settings', logboek: 'log' }[match[2]] || 'overview';
    }
    try {
        await loadApps();
    } catch (error) {
        main.replaceChildren(h('section', { class: 'card' }, h('p', { class: 'error' }, error.message)));
        return;
    }
    drawTabs();
    drawMain();
}

// Keep the dots in the tabs fresh while the page is open (not while typing in the settings)
setInterval(async () => {
    if (document.hidden || document.getElementById('panel').hidden) return;
    try {
        await loadApps();
        drawTabs();
        const app = state.apps.find((a) => `app:${a.id}` === state.tab);
        if (app && (state.view[app.id] || 'overview') === 'overview' && !main.querySelector('.confirm, .connect input')) drawMain();
    } catch {
        // next time
    }
}, 60_000);

start();
