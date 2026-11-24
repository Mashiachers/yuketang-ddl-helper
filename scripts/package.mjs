import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const distDir = path.join(root, 'dist');
const releaseDir = path.join(root, 'release');
const tag = (process.env.RELEASE_TAG || `v${pkg.version}`).replace(/[^a-zA-Z0-9._-]/g, '');
const archiveName = `${pkg.name}-${tag}.zip`;
const archivePath = path.join(releaseDir, archiveName);

if (!fs.existsSync(path.join(distDir, 'manifest.json'))) {
  console.error('dist/manifest.json not found. Run `npm run build` first.');
  process.exit(1);
}

fs.mkdirSync(releaseDir, { recursive: true });
if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath);

if (process.platform === 'win32') {
  execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `Compress-Archive -Path '${distDir.replace(/'/g, "''")}\\*' -DestinationPath '${archivePath.replace(/'/g, "''")}' -Force`,
    ],
    { stdio: 'inherit' },
  );
} else {
  execFileSync('zip', ['-r', '-q', archivePath, '.'], { cwd: distDir, stdio: 'inherit' });
}

const sizeKb = (fs.statSync(archivePath).size / 1024).toFixed(1);
console.log(`Packaged ${path.relative(root, archivePath)} (${sizeKb} KB)`);
