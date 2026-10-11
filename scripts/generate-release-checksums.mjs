import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const packageMetadata = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
const installerName = `Nemoto_${packageMetadata.version}_x64-setup.exe`;
const bundleDirectory = resolve('src-tauri', 'target', 'release', 'bundle', 'nsis');
const installerPath = resolve(bundleDirectory, installerName);
const checksumPath = resolve(bundleDirectory, 'SHA256SUMS.txt');

if (!existsSync(installerPath)) {
    throw new Error(
        `Expected the NSIS installer at ${installerPath}. Run npm run package:installer first.`,
    );
}

const digest = createHash('sha256').update(readFileSync(installerPath)).digest('hex');
const checksumDocument = `${digest}  ${installerName}\n`;
writeFileSync(checksumPath, checksumDocument, 'utf8');

const [savedDigest, savedName] = readFileSync(checksumPath, 'utf8').trim().split(/\s{2}/);
const verifiedDigest = createHash('sha256').update(readFileSync(installerPath)).digest('hex');
if (savedName !== installerName || savedDigest !== verifiedDigest) {
    throw new Error('The generated checksum file did not verify against the release installer.');
}

console.log(`SHA256SUMS.txt: ${digest}  ${installerName}`);
