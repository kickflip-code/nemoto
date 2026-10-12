# Nemoto

Nemoto is a local-first desktop workspace for mapping processes and connecting them to reusable resources, roles, systems, documents and notes. Your workspace is stored locally.

**Status:** **Nemoto 1.0.0-beta.1** is an upcoming **Windows x64 Core beta**. Source is available here; no beta executable has been published yet. Keep a separate backup of important work.

## Get started

Build from source using the commands below. For a portable build, place `src-tauri/target/release/nemoto.exe` in its own application directory. Keep the executable and its adjacent `data` folder together. Start `nemoto.exe`, then choose **Create your first process** or **Import existing work**.

The interface is English. See the [user guide](_docs/help/in-app-help.md) for mapping, Journal, themes, import/export, backups and optional local AI. The [synthetic demo](_docs/testdata/lindhamn-service/README.md) contains fictional data for trying the app.

## Files and compatibility

New Portfolio files use `.nemoto`; process exports use `.nemoto-process`. Existing `.axiom` / `.ax` files remain readable. Some technical identifiers retain the old name to preserve files, packages and local data; see the [compatibility reference](_docs/format/AXIOM_FORMAT.md#nemoto-naming-and-stable-contracts). Settings and chat history are not automatically transferred from an old application profile.

## License and release scope

Author and publisher: **Kickflip Code**. Copyright © 2026 Kickflip Code. Core uses [MPL-2.0](LICENSE); see [Licensing](LICENSING.md) for notices and scope. The npm package is deliberately private because distribution is a desktop application, not an npm package.

This beta is Core only. It includes the external plugin host, but no plugin packages, SDK guests or authoring templates are published or bundled here. Read the [plugin safety guide](_docs/help/in-app-help.md#plugins-and-safety) before installing external packages.

Final native verification, the signing decision and third-party notices remain release gates. The configured installer name is `Nemoto_1.0.0-beta.1_x64-setup.exe`; this is not a published or verified installer.

## Build from source

Install Node.js 22.12+ and npm, stable Rust with rustup, the Windows C++ build tools (Desktop development with C++) and Microsoft Edge WebView2 Runtime. Windows x64 is the supported beta target.

```powershell
npm ci
npm run verify:core
npm run tauri dev
# Or build the portable executable:
npm run package:portable
```

`verify:core` runs the public frontend tests, production build, bundle budget and native library tests. Private plugin examples, SDK guests, browser POC previews and their dependent tests are excluded; they are not claimed as tested by this command. Normal external plugin installation remains supported. The older profile-based AI demonstration has no bundled profiles in this source distribution; Portfolio Chat is the Core AI workflow.

No release has been published from this snapshot. Final native artifact validation, signing decision and third-party notices remain release gates. Do not substitute an earlier private build for a binary built from this source.
