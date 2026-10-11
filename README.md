# Nemoto

Nemoto is a local-first desktop workspace for mapping processes and connecting them to reusable resources, roles, systems, documents, and notes.

This repository is preparing the first public Windows x64 Core beta: **Nemoto 1.0.0-beta.1**, published under **Kickflip Code**. The beta has not been published yet and may still contain defects. Keep a separate backup of important work.

For the complete current workflow, open **Help** in Nemoto or read the
[Nemoto user guide](_docs/help/in-app-help.md).

## Start the Windows portable candidate

The current delivery boundary is Windows x64 portable Core for personal use.
Build it with `npm run package:portable`; the executable is
`src-tauri/target/release/nemoto.exe`. Keep the executable and its `data` folder
together in a separate Nemoto application directory, then start `nemoto.exe`.
On a new profile, choose **Create your first process** or **Import existing work**.
Use **Settings → Data & Backup → Restore** to replace a complete Portfolio.

Core is licensed under **MPL-2.0**; owner-authored plugins use **Apache-2.0**
under the directory boundaries in [Licensing](LICENSING.md). The first public
release includes **Core only**. Plugin publication is deferred. Signing,
Core-only source preparation and final release verification remain open.
The configured installer artifact name is
`Nemoto_1.0.0-beta.1_x64-setup.exe`; this is not a published or verified installer.

## The first five minutes

- **Create a process** to map a workflow on one canvas with optional rows and columns.
  Use the **Rows** and **Columns** icon buttons in the floating toolbar to show
  or hide each direction. First activation creates a division; canvas **+** buttons add more. Double-click a heading to rename it; drag a boundary
  to resize. Divisions stay anchored at canvas origin (0,0). Panning past the
  top/left boundary gives elastic resistance and returns when released.
  Hiding preserves headings, sizes, membership and positions; deleting a division
  keeps its steps. Resizing/reordering leaves nodes and manual arrow bends fixed.
  Rows and columns organize content; arrows determine flow. New files use schema
  4: old blank/horizontal/vertical maps migrate without moving content, but older
  Nemoto versions are not promised to read the new format.
- Add **Event** items when something occurs, is observed, is emitted, or becomes
  true—for example an order arriving, an SLA expiring, or a signal being
  published. Timing is optional.
- **Create resources** for systems, roles, documents, and other things reused across processes.
- **Open the Journal** to keep supporting notes close to the work.
- Press `Ctrl+K` to search, `Ctrl+N` for a new process, and `Ctrl+S` to save immediately.
- With the canvas focused, press `Ctrl+D` to duplicate selected nodes and their
  internal connections, including independent copies of all nested drilldowns.
  Use `Ctrl+C`, open another canvas in the same Portfolio, and press `Ctrl+V`
  to reuse a flow there. Resource references remain shared.
- Use Tab to reach process and folder names, then Enter or Space to open them.
  `Shift+F10` opens their context menu; it also opens a focused canvas node's
  menu, or the single selected node's menu when the canvas is focused.
- Outside connection routes avoid node rectangles while respecting the chosen
  side. Select a connection to drag its segment handles; **Adjust route** enables
  manual orthogonal editing for ordinary curves. **Reset automatic route**
  restores its automatic mode. Manual bends stay fixed while endpoint leads
  follow moved nodes. Undo, save/reopen and HTML export preserve route edits.
- **Read map** in the canvas toolbar opens an optional text view with node
  headings, directed connection links and selection information. Reading it
  leaves the map unchanged. This is a reading baseline; full nonvisual graph
  editing and final native screen-reader validation are not complete.
- Open **Settings → Data & Backup** to confirm the automatic backup interval and location.

The interface is English in this release candidate. Swedish icon-search terms are supported, but full interface localization is not yet included.

For a complete synthetic Swedish example, import the
[Lindhamn Service demo Portfolio](_docs/testdata/lindhamn-service/Lindhamn-Service.axiom).
It contains six processes, shared resources and an offline Journal demonstration
guide, with no plugins required. See its [usage and verification notes](_docs/testdata/lindhamn-service/README.md).
It is not loaded automatically; use a temporary reference for inspection and a
disposable profile for full restore and RC save/restart testing.

Drilldowns use ordinary semantic steps with `subGraphId`; the abandoned
development node type `subprocess` is no longer accepted or migrated. Such
development files must be regenerated with current node types. The maintained
Lindhamn file and its generator use the current model.

Above the canvas, zoom and Fit View are grouped together. **Grid** toggles
the background without changing snapping; this preference stays on the device
and is not included in exported process files.

## Where Nemoto keeps data

The installed Windows build stores its working files locally under:

```text
%APPDATA%\nemoto\nemoto\config\
```

Important files:

- `portfolio.json` — the active portfolio;
- `portfolio.json.bak` — the previous saved copy checked by startup recovery;
- `config.json` — application configuration;
- `themes\` — one Core-managed `.axiom-theme.json` copy per installed custom
  theme;
- `plugins\` and `plugin-runtime\` — installed plugin packages and admitted
  runtime files on this device;
- `plugin-device-settings\` — plugin settings that stay on this device; and
- `plugin-secret-indexes\` — secret names and metadata. Secret values use the
  Windows credential store rather than this folder.

Scheduled snapshots default to `Documents\NemotoBackups` and can be redirected
in **Settings → Data & Backup**. That section retains the latest scheduled
backup result, attempt time, destination, and any error in device-local WebView
storage. A failed backup or cleanup triggers a notification; repeated failures
of the same kind at the same destination stay quiet until the status changes.
Installed custom themes are device-local files
under `themes\`; the active built-in/custom theme ID is in `config.json`. UI
preferences, the Local AI connection, and Portfolio Chat history use
device-local WebView storage. Full and scheduled `.nemoto` backups add a
non-canonical snapshot of the active appearance so it can be reviewed during
restore; they do not copy the rest of the installed theme library or other
device-local settings.

The portable build redirects Nemoto's primary managed files, including installed
themes, to a `data` folder beside `nemoto.exe`. Device-local WebView information
remains separate: `%LOCALAPPDATA%\com.joseph.nemoto` holds the WebView profile,
and `%APPDATA%\com.joseph.nemoto\.window-state.json` holds window state.
Portable is not a fully isolated profile; plugin secrets still use the OS store.
Changing application identity does not automatically transfer existing settings
or chat history. Keep the existing application and its data backed up before switching to Nemoto. Settings and chat history are not automatically transferred. Use a full `.nemoto` export to move the Portfolio and its
active appearance. Export other important custom themes separately.

Updates do not intentionally change the portfolio format without a migration path. Unknown future/plugin fields are preserved when a portfolio is read and written.

At startup and before a durable write, Nemoto checks IDs and cross-references.
Canvas edits and viewport changes are saved only to the process and drilldown
level that was loaded; switching processes or restoring a Portfolio reloads
the appropriate canvas before further edits are synchronized.
Hard integrity errors leave the existing file untouched and open the startup
safe mode, where the previous saved recovery file can be restored when
available. Non-destructive warnings such as stale Journal references remain
readable.

## Import, export, backup, and restore

| Task | Use | Result |
| --- | --- | --- |
| Move or archive a complete portfolio | **File → Export... → Export Portfolio** | `.nemoto`, including all Journal notes, portfolio-owned plugin data, and a snapshot of the active appearance |
| Share one process | **File → Export... → Export Active Process** | `.nemoto-process`, with optional linked resources and Shareable notes |
| Share a read-only offline view | **File → Export... → Interactive HTML Viewer** | Standalone `.html` with the active appearance and an embedded `.nemoto-process` download |
| Inspect another file without replacing current work | **File → Import...** | Temporary reference until merge, discard, or restart |
| Replace the complete active portfolio | **Settings → Data & Backup → Restore...** | Validates before switching and asks how to handle the included active appearance |

Text-based `.nemoto`, `.nemoto-process`, and `.json` imports are limited to 50 MB. Visio `.vsdx` files have separate compressed and expanded-size safety limits.

In **File → Import...**, choose **Resources** or **Portfolio or process**, then
drop one file onto the source area or click it to choose a file. Windows desktop
file drops use the same validation and size limits as the file picker.

Very large single-process maps can exceed the practical interactive capacity of
the DOM-based Canvas even when the complete Portfolio remains valid. The
50,000-node stress fixture is a data-integrity ceiling, not an interactive Canvas
target; split large operating models across processes and drilldowns. Canvas
renders only visible elements, while Dependency Map deliberately limits one
result to 350 entities.

Temporary process previews disable canvas editing and clipboard shortcuts;
Space-pan remains available. Choose **Exit Preview** to resume editing the
active process.

Full restore waits for any active save and saves unsaved Portfolio changes
before replacing the file, preserving that working version in
`portfolio.json.bak`. If saving fails, the current work stays open. Keep Nemoto
open until **Restoring…** finishes.

For `.nemoto-process` and HTML sharing, only linked Shareable Journal notes can be included.
Internal notes are excluded from those formats but remain in the local portfolio
and a full `.nemoto` export. **Internal is an export filter, not encryption.**

The HTML viewer allows selecting and copying reader text, scrolling long notes
and resource details, and closing the details sidebar with **Close details**.
Select a node to reopen the panel. Re-export existing HTML files to receive viewer fixes.
Nodes show a box icon for included linked resources and a document icon for
included linked Journal notes, including in nested graphs.

## Appearance and custom themes

Choose **Void**, **Polar**, or **Brutalist** under **Settings → Appearance**.
New profiles start in **Polar**. Saved theme choices remain in effect.
**Theme Studio** creates and imports custom themes. Custom themes stay on the
device as independent files under Nemoto's managed `themes\` folder. Import
creates a Nemoto-owned copy, so the source file can be moved or deleted
afterward. Download a `.axiom-theme.json` file when you need to move a theme.
The theme selector can also preview **Void**, **Polar**, and **Brutalist**
directly without first creating a custom theme. The element inspector exposes
the complete public token contract; values that differ from the selected
baseline are marked and can be reset one token at a time.
An existing stable-ID conflict opens an explicit choice to keep the installed
file or replace and activate the imported version; it is never replaced silently.
Theme Studio can embed a PNG/WebP logo and WOFF2 interface font,
set the displayed product name, and apply six optional Core-rendered recipes:
density, corners, elevation, controls, surfaces, and process nodes. Density also
covers rails, docks, lists, and dialog rows. The embedded family is used for the
interface, display headings, and node labels. The Interactive HTML Viewer refreshes and embeds
the active theme's product name, logo, font, recipes, tokens, semantic Event
treatment, semantic node and swimlane palette colors, and node layouts at
export time, and remains self-contained offline. Full and
scheduled `.nemoto` backups embed only the active custom theme as a restore
snapshot. Restore never silently replaces a different installed theme with the
same stable ID; the receiving library remains the canonical owner. Restoring a
new or replacement custom theme installs its local file and persists its active
selection as one guarded native operation. If the selection cannot be written,
Nemoto removes the new file or restores the exact previous file. Export theme
files separately when you need to move themes that are not active. Theme Studio
switches to a compact element rail in smaller supported windows, and its two
panel buttons can hide either side panel for a larger preview.

The Theme Studio and **Settings → Appearance** theme menus scroll when the
installed library exceeds their visible height and bring the active selection
into view. Theme color samples use a foreground-derived outline so very dark
and very light colors remain distinguishable.

Switching themes, starting an import or new theme, and closing the window all
warn before an unsaved draft is discarded. Choosing a baseline button changes the draft's art
direction and resets its public tokens; branding, embedded assets, typography,
and visual recipes are left unchanged.

## External plugins

Core includes the capability-limited external plugin host, but this beta does not bundle or publish plugin packages, examples or authoring templates. Installed plugins and device settings stay on the device. Deactivating a plugin preserves its Portfolio data. Read the [plugin safety guide](_docs/help/in-app-help.md#plugins-and-safety) before installing a package.

## If Nemoto cannot open a portfolio

Nemoto enters a safe startup screen and pauses auto-save. Choose **Manage damaged processes** to read the active file's process names, descriptions and process data even when individual processes fail validation. Select the processes you want to remove. Nothing is preselected or written while you inspect the list. **Remove selected processes** becomes available only when the remaining portfolio passes schema and integrity checks. It preserves the original file byte-for-byte as `portfolio.before-repair-<unique-id>.json` beside `portfolio.json`, leaves `portfolio.json.bak` intact, then saves the remaining data. The screen shows the preserved file's path; choose **Open repaired portfolio** to enter the workspace. Resources, Journal and their links are retained, so links to removed processes can remain unresolved. Unsupported node types are not converted.

If the file changed meanwhile, choose **Reload process list** and review your selection again. The check uses the saved file itself; number formatting in the interface does not count as a file change. This recovery path requires readable JSON and fixes only explicitly removed processes; malformed JSON, errors elsewhere in the portfolio and unsupported future file versions still require a suitable backup. **Try again** retries normal loading. **Restore recovery file** validates the previous saved copy before replacing the active file; its presence does not guarantee it is valid.

If Nemoto reports a save error, do not close the app until the problem is resolved or you have exported a manual backup. Closing with unsaved changes shows options to save, close without saving, or cancel.

## Current release-candidate limits

- Windows x64 is the supported packaging target for the first candidate.
- The installer is not yet code-signed.
- Core is MPL-2.0; the Core-only public source and third-party notice review are still being prepared.
- Local AI is optional and experimental; portfolio editing does not depend on it.
- The interface is English. Swedish terms are available only for icon search.
- Visio and table imports can be partial and should be reviewed after merging.
- Events distinguish Generic, Message, Signal, Condition, Timer, Error, and
  Milestone kinds plus Observed, Emitted, and Neutral behavior. Optional timing
  supports a start/end, year-through-day precision, all-day dates, or an exact
  time with a time zone. Recurrence, reminders, and calendar-service
  synchronization are not included.
- Internal Journal notes are not encrypted; they are only excluded from process-sharing exports.
- External plugins are capability-limited. Declarative packages remain host-rendered; executable packages are restricted to admitted no-WASI modules and the closed proposal broker. Plugin packages and private plugin conformance tests are not included.


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
