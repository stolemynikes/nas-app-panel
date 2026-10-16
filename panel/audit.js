import fs from 'node:fs';
import path from 'node:path';

// The action log: who did what in the panel, and when. One line per action in data/audit/YYYY-MM.jsonl, kept a year.
// Never secrets: a changed password or key is written as "nieuwe waarde".

const KEEP_MONTHS = 12;

export function createAudit(dir, { now = () => new Date() } = {}) {
    function add(user, action, detail = '') {
        const entry = { time: now().toISOString(), user: user?.name || '(onbekend)', action: String(action), detail: String(detail).slice(0, 500) };
        try {
            fs.mkdirSync(dir, { recursive: true });
            fs.appendFileSync(path.join(dir, `${entry.time.slice(0, 7)}.jsonl`), `${JSON.stringify(entry)}\n`, { mode: 0o600 });
        } catch {
            console.log(`Action log could not be written: ${entry.user} ${entry.action}`);
        }
    }

    // Newest first, optionally only one user and/or a search text
    function read({ user = '', q = '', limit = 500 } = {}) {
        let files = [];
        try {
            files = fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}\.jsonl$/.test(f)).sort().reverse();
        } catch {
            return [];
        }
        const search = String(q).toLowerCase();
        const entries = [];
        for (const file of files) {
            for (const line of fs.readFileSync(path.join(dir, file), 'utf8').split('\n')) {
                if (!line) continue;
                try {
                    const entry = JSON.parse(line);
                    if (user && entry.user !== user) continue;
                    if (search && !`${entry.action} ${entry.detail}`.toLowerCase().includes(search)) continue;
                    entries.push(entry);
                } catch {
                    // a broken line is skipped
                }
            }
            if (entries.length >= limit * 2) break;
        }
        return entries.sort((a, b) => (a.time < b.time ? 1 : -1)).slice(0, limit);
    }

    function prune() {
        const cutoff = new Date(now());
        cutoff.setMonth(cutoff.getMonth() - KEEP_MONTHS);
        const oldest = cutoff.toISOString().slice(0, 7);
        try {
            for (const file of fs.readdirSync(dir)) if (/^\d{4}-\d{2}\.jsonl$/.test(file) && file.slice(0, 7) < oldest) fs.rmSync(path.join(dir, file));
        } catch {
            // no log yet
        }
    }

    return { add, read, prune };
}
