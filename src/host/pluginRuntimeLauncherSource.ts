import launcherScript from './pluginRuntimeLauncherFrame.js?raw';

export const PLUGIN_RUNTIME_LAUNCHER_SCRIPT_SHA256 = 'sha256-3Lk7hrUDdFUpZ3G1huSO2t6ahDeLHB28iCU7YoYmOPs=';

export const PLUGIN_RUNTIME_LAUNCHER_CSP = [
    "default-src 'none'",
    `script-src '${PLUGIN_RUNTIME_LAUNCHER_SCRIPT_SHA256}' blob:`,
    "worker-src blob:",
    "child-src blob:",
    "connect-src 'none'",
    "img-src 'none'",
    "style-src 'none'",
    "font-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-src 'none'",
].join('; ');

export const PLUGIN_RUNTIME_LAUNCHER_DOCUMENT = [
    '<!doctype html>',
    '<html><head>',
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${PLUGIN_RUNTIME_LAUNCHER_CSP}">`,
    '<meta name="referrer" content="no-referrer">',
    '</head><body>',
    `<script>${launcherScript}</script>`,
    '</body></html>',
].join('');
