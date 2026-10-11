import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const readText = path => readFileSync(resolve(path), 'utf8');
const readJson = path => JSON.parse(readText(path));
const failures = [];

const requireValue = (label, actual, expected) => {
    if (actual !== expected) {
        failures.push(`${label} reports ${JSON.stringify(actual)}; expected ${JSON.stringify(expected)}.`);
    }
};

const requireMatch = (label, text, pattern) => {
    const match = text.match(pattern);
    if (!match?.[1]) failures.push(`${label} does not expose a readable version.`);
    return match?.[1];
};

const packageMetadata = readJson('package.json');
const packageLock = readJson('package-lock.json');
const tauriConfig = readJson('src-tauri/tauri.conf.json');
const cargoManifest = readText('src-tauri/Cargo.toml');
const cargoLock = readText('src-tauri/Cargo.lock');
const appVersionSource = readText('src/lib/appVersion.ts');
const settingsDialogSource = readText('src/components/dialogs/SettingsDialog.tsx');
const readme = readText('README.md');
const changelog = readText('CHANGELOG.md');

const releaseVersion = packageMetadata.version;
requireValue('Core npm license', packageMetadata.license, 'MPL-2.0');
requireValue('Core installer publisher', tauriConfig.bundle?.publisher, 'Kickflip Code');
requireValue('Core Cargo license',
    requireMatch('Core Cargo license', cargoManifest, /^license\s*=\s*"([^"]+)"/m),
    'MPL-2.0');
if (typeof releaseVersion !== 'string' || releaseVersion.length === 0) {
    failures.push('package.json does not expose a release version.');
}

requireValue('package-lock.json', packageLock.version, releaseVersion);
requireValue('package-lock.json root package', packageLock.packages?.['']?.version, releaseVersion);
requireValue('src-tauri/tauri.conf.json', tauriConfig.version, releaseVersion);
requireValue(
    'src-tauri/Cargo.toml',
    requireMatch('src-tauri/Cargo.toml', cargoManifest, /^version\s*=\s*"([^"]+)"/m),
    releaseVersion,
);
requireValue(
    'src-tauri/Cargo.lock nemoto package',
    requireMatch(
        'src-tauri/Cargo.lock nemoto package',
        cargoLock,
        /\[\[package\]\]\s*\r?\nname\s*=\s*"nemoto"\s*\r?\nversion\s*=\s*"([^"]+)"/m,
    ),
    releaseVersion,
);

if (!/import packageMetadata from ['"]\.\.\/\.\.\/package\.json['"]/.test(appVersionSource)
    || !/APP_VERSION\s*=\s*packageMetadata\.version/.test(appVersionSource)) {
    failures.push('src/lib/appVersion.ts must derive APP_VERSION directly from package.json.');
}

if (!settingsDialogSource.includes('{APP_VERSION}')) {
    failures.push('Settings must render APP_VERSION from the shared build-time source.');
}

if (!readme.includes(`Nemoto ${releaseVersion}`)
    || !readme.includes(`Nemoto_${releaseVersion}_x64-setup.exe`)) {
    failures.push('README.md does not name the current release and installer consistently.');
}

if (!changelog.includes(`## [${releaseVersion}]`)) {
    failures.push('CHANGELOG.md does not contain a section for the current release version.');
}

if (failures.length > 0) {
    throw new Error(`Release metadata is inconsistent:\n- ${failures.join('\n- ')}`);
}

console.log(`Release metadata: ${releaseVersion} across package, Cargo, Tauri, UI, README, and changelog.`);
