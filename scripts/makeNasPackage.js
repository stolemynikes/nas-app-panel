// Makes build/nas-beheer-nas.zip: only what the NAS needs to run the panel.
// Never included: .env (password, keys), data, node_modules, tests.
// Run with: node scripts/makeNasPackage.js   - then follow docs/installatie-nl.md
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const include = ['Dockerfile', 'docker-compose.yml', '.dockerignore', '.env.example', 'package.json', 'package-lock.json', 'index.js', 'server.js', 'config.js', 'ngrok.yml', 'README.md', 'docs', 'panel', 'public', 'routes'];

const folder = path.join('build', 'nas-beheer');
fs.rmSync('build', { recursive: true, force: true });
fs.mkdirSync(folder, { recursive: true });

for (const name of include) {
    fs.cpSync(name, path.join(folder, name), { recursive: true });
}

// Windows' own tar can make zip files (the tar of Git Bash cannot)
const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\Windows', 'System32', 'tar.exe') : 'tar';
const zip = path.join('build', 'nas-beheer-nas.zip');
try {
    execFileSync(tar, ['-a', '-c', '-f', zip, '-C', folder, '.']);
    console.log(`Made ${zip}`);
} catch {
    console.log(`Could not make a zip; copy the folder ${folder} to the NAS instead`);
}
console.log('Not included on purpose: .env and data/ (make .env on the NAS), node_modules, test');
