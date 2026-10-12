import { describe, expect, it } from 'vitest';
import tauriConfig from '../../src-tauri/tauri.conf.json';
import launcherScript from './pluginRuntimeLauncherFrame.js?raw';
import {
    PLUGIN_RUNTIME_LAUNCHER_CSP,
    PLUGIN_RUNTIME_LAUNCHER_DOCUMENT,
    PLUGIN_RUNTIME_LAUNCHER_SCRIPT_SHA256,
} from './pluginRuntimeLauncherSource';

describe('isolated plugin launcher source', () => {
    it('pins the exact launcher bytes in both frame and Tauri CSP', async () => {
        const digest = await crypto.subtle.digest(
            'SHA-256',
            new TextEncoder().encode(launcherScript),
        );
        const hash = `sha256-${btoa(String.fromCharCode(...new Uint8Array(digest)))}`;
        expect(PLUGIN_RUNTIME_LAUNCHER_SCRIPT_SHA256).toBe(hash);
        expect(PLUGIN_RUNTIME_LAUNCHER_CSP).toContain(`script-src '${hash}' blob:`);
        expect(tauriConfig.app.security.csp).toContain(`'${hash}'`);
        expect(tauriConfig.app.security.csp).toContain('worker-src blob:');
        expect(PLUGIN_RUNTIME_LAUNCHER_DOCUMENT).toContain(`<script>${launcherScript}</script>`);
    });

    it('keeps the opaque frame offline and strips ambient Worker authority', () => {
        expect(PLUGIN_RUNTIME_LAUNCHER_CSP).toContain("default-src 'none'");
        expect(PLUGIN_RUNTIME_LAUNCHER_CSP).toContain("connect-src 'none'");
        expect(PLUGIN_RUNTIME_LAUNCHER_CSP).toContain("object-src 'none'");
        expect(launcherScript).toContain("event.source !== parent");
        expect(launcherScript).toContain('accepted = true');
        expect(launcherScript).toContain('await import(__nemotoModuleUrl)');
        expect(launcherScript).toContain("'fetch', 'XMLHttpRequest', 'WebSocket'");
        expect(launcherScript).toContain("'Worker', 'SharedWorker', 'BroadcastChannel'");
        expect(launcherScript).toContain("typeof globalThis.__TAURI_INTERNALS__ !== 'undefined'");
        expect(launcherScript).toContain("typeof globalThis.__TAURI__ !== 'undefined'");
        expect(launcherScript).not.toMatch(/@tauri-apps|invoke\s*\(/);
    });

    it('emits syntactically valid trusted Worker source', () => {
        const template = launcherScript.match(
            /const createWrapperSource = \(moduleUrl, secret\) => `([\s\S]*?)`;\r?\n\r?\n    const handleControl/,
        )?.[1];
        expect(template).toBeDefined();

        const workerSource = template!
            .split('${JSON.stringify(secret)}').join(JSON.stringify('test-secret'))
            .split('${JSON.stringify(moduleUrl)}').join(JSON.stringify('blob:test-module'));

        expect(() => new Function(workerSource)).not.toThrow();
    });
});
