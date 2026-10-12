# Nemoto Help

This guide describes the controls and file behavior in the current beta
candidate. Open it from **Help** in the app rail or press **F1**.

## Install and start on Windows

Nemoto 1.0.0-beta.1 is being prepared as a public Windows x64 Core beta under
the Kickflip Code publisher brand. It has not been published yet; plugin
distribution is deferred. The current local build supports portable use.
Keep `nemoto.exe` and its `data` folder together in a separate application
directory. Start `nemoto.exe`; a new profile opens the welcome screen.
Installers and external distribution have not passed their separate release gate.

The interface is in English. Canvas controls use **Division**, **Rows** and
**Columns**. User-defined headings retain their original language. Windows x64 is
the supported release target; macOS and Linux packages are not supplied or
validated for this candidate.

## Getting started

Start with one of two paths on the **Welcome to Nemoto** screen:

1. Choose **Create your first process**, enter a name, and choose **Create Process**.
2. Choose **Import existing work** if you already have a Nemoto, Visio,
   spreadsheet, or resource file.

The main workspace has a few stable areas:

- **File** contains new, save, import, and export actions.
- The app rail switches between **Designer** and **Dependency Map** and opens
  Journal, Portfolio, Help, and Settings.
- **Process Portfolio** in the left panel organizes processes, folders, and
  nested process detail.
- The canvas is where you map the active process. Select an item to edit it in
  the right panel.
- The Journal opens along the bottom and keeps notes close to the work they
  describe.
- **Portfolio** opens an overview of processes, resources, and Journal content.

Core portfolio editing is local. Portfolio Chat and plugins are optional.

## Everyday workflows

### Map a process

1. Choose **File → New process...** or press **Ctrl+N**.
2. Name the process. It starts without visible divisions.
3. Use the canvas creation tools to add Start, Action, Decision, System, End,
   Note, or Event items.
4. Connect steps by dragging between their connector handles.
5. Select a step or connection to edit its label, description, appearance,
   linked resources, or routing in the right panel.

The floating creation toolbar has **Rows** (rows) and **Columns** (columns)
icon buttons. Each shows or hides that direction; the first activation creates
one division if none exists. Use **+** after the last visible column or row
on the canvas to add more. Their names have
no built-in business meaning. Columns have a header strip above the content;
rows have discreet horizontal headings at their beginning and subtle bands.
Divisions are anchored at canvas origin (0,0); dragging a heading cannot move
its background. Panning and zooming still change your view of the whole map.
Panning past the top or left boundary gives elastic resistance; releasing the
pointer or ending scrolling returns the view to that boundary. Only the exceeded
axis returns. A small margin keeps column headings visible. Existing nodes and
manual arrow bends at negative coordinates remain reachable. **Fit View** and
zoom buttons can still frame the whole map. With reduced motion enabled in the
operating system, the return happens immediately. Overscroll is not saved.
Double-click a heading, or focus it and press **F2**/**Enter**, to edit its name
in place. **Enter** or leaving the field saves; **Escape** cancels. Empty names
keep the previous name. Drag a column's right boundary or a row's bottom boundary
to resize, with a 32 px minimum. A completed drag is one undo step; **Escape**
cancels an active resize. Focus a boundary with Tab and use the direction's arrow
keys to resize by 16 px. Select a heading for color, **Move left**/**Move right** for columns or **Move up**/**Move down** for rows,
and the red **Delete column**/**Delete row** button in the inspector. The upper-right view controls use icons with hints on hover or keyboard focus.
Zoom is displayed as a percentage between **Zoom out** and **Zoom in** and updates
as you zoom. **Read map**, **Show linked content** and **Toggle Grid** remain
available there. Choose **Fit View** for an overview.

The **Rows** and **Columns** buttons only change visibility once divisions exist. Names, dimensions,
order, memberships, positions and manual routes survive hiding and saving.
**Delete column**/**Delete row** removes just that division and clears its membership on steps; no
steps or connections are deleted. Resizing and reordering change boundaries,
not node positions, memberships or arrow bends. After changing boundaries,
steps can therefore retain memberships that differ from their visible cell.
Select a step and set **Row** and **Column** independently, including **Unassigned**, or drag it to assign the visible directions from its top-left
position. A hidden direction keeps its previous membership during dragging.
Rows and columns organize the map; only arrows define process flow.

Multi-selection dragging assigns each moved step independently. Copying within
the same canvas retains its row and column; copying to another canvas clears
memberships that do not exist there. Copied drilldowns keep their divisions with
new IDs. **Ctrl+Z** and **Ctrl+Y** undo/redo division edits within the current
canvas session, and every drilldown has its own division settings.

Existing vertical swimlanes become columns, horizontal swimlanes become rows,
and blank canvases open without divisions. Names, colors, order, dimensions,
positions and connections are retained. New saves use file schema 4; older
Nemoto builds may reject them. Do not use an older build to edit the new files.
Offline HTML uses the same division rendering, including hidden directions.
Visio imports continue through the existing importer and preserve its current
fidelity limits; importing is not a guarantee of a pixel-identical Visio page.

Use folders in **Process Portfolio** to group related processes, and press
**Ctrl+K** to find a process, resource, or note.

For a selected connection, **Routing** keeps five choices: **Auto**, **Outside
right**, **Outside left**, **Above**, and **Below**. Outside modes visit the
chosen outer corridor and seek a short orthogonal path around node rectangles
with 24 px clearance. **Outside margin** controls the chosen outer corridor.
Clear paths stay simple; blocked legs can detour above or below intervening
nodes. Auto retains its existing curve behavior. Routing does not avoid other
connections or labels; groups and swimlane backgrounds are not obstacles.

Select an outside connection to show its segment handles. Drag an internal
segment perpendicular to itself; arrow keys on a focused handle move it 8 px.
For an ordinary curve or diagonal imported route, choose **Adjust route** on
the canvas first to create an orthogonal manual route. **Escape** cancels an
active drag. Releasing the pointer saves one undoable change.

The inspector shows **Manual route** and **Reset automatic route**. Reset
removes the manual bends while retaining the chosen outside mode (or Auto).
Manual bends remain at absolute canvas positions when a node moves; orthogonal
endpoint leads reconnect to the moved handles. Recheck manual routes for new
crossings after moving nodes. Copy/paste offsets their bends with the nodes.
Saving and HTML/process export retain these routes.

If overlapping nodes, tight clearances or the bounded routing search prevent
a safe route, **Route blocked** marks the fallback line. Move nodes or adjust
that connection manually; the fallback is not claimed to be obstacle-free.

### Keep supporting information nearby

- Create reusable resources in the **Resources** area of the left panel or open
  **Portfolio** for a wider overview.
- Link resources to a selected process step from the right panel.
- Open Journal from the book icon or with **Ctrl+J**, then choose **New Note**.
- Use the Journal's **Linked Context** area to connect a note to the work it
  explains.
- Press **Ctrl+Shift+J** when you need a quick new note.

### Finish safely

Watch the save indicator, especially after a large import or edit. Press
**Ctrl+S** before closing or exporting important work, and keep scheduled
backups enabled for portfolios you cannot easily recreate.

## Processes, resources, and Journal

### Organize the Process Portfolio

**Processes** describe how work moves. A process can contain flow steps,
decisions, systems, notes, events, connections, rows and columns.

- Create a folder with **File → New folder...** or **Ctrl+Shift+N**.
- Drag processes and folders in the tree to move them into a folder or back to
  the root.
- Right-click an item for its available rename, duplicate, expand, collapse, or
  delete action.
- Deleting a folder moves its direct processes and subfolders to the root; it
  does not delete their contents.

Supported flow steps can contain a child graph for more detail. Select a step
and choose **Create Drilldown** or **Open Drilldown** in the right panel, use
**Open Drilldown** in its context menu, or Alt-double-click it. Breadcrumbs and
the nested items in **Process Portfolio** return you to each level. A newly
opened empty drilldown is only a draft until its first structural edit is made.

The step keeps its semantic type (for example Action or Decision) when it has
a drilldown. There is no separate drilldown node type. Abandoned development
files using the removed `subprocess` node type are rejected without conversion;
use the current generated example instead.

Generated maps need visual review as well as file validation. Node coordinates
are top-left positions, so different shapes should align their centers. Use **Fit View**, zoom and pan to inspect the whole flow. Outside connector routes now follow their configured side and
margin in both the canvas and HTML viewer; explicitly stored bend points take
precedence. These routes do not automatically avoid every intervening node.

Navigation through the process tree, search or **Usage** loads the destination
canvas, including when returning from a drilldown to the same main process.
Edits and panning apply only to the currently loaded process level. Undo history
starts fresh when you change canvas, so **Ctrl+Z** cannot bring a previous
process or drilldown into the new one.

To reuse a flow, select its nodes with the canvas focused and press **Ctrl+C**.
Open another process or drilldown in the same Portfolio, focus that canvas,
and press **Ctrl+V**. The copied nodes, connections between them, group children,
and every nested drilldown receive new identities. Editing the copied flow does
not change the original. Repeated pastes create separate copies. **Duplicate**
in a node's context menu and **Ctrl+D** use the same independent-copy behavior
on the current canvas. **Ctrl+Z** and **Ctrl+Y** undo and redo the insertion.

For example, create an overall device-management process, add a Computers step,
open its drilldown, and paste nodes copied from an existing computer-lifecycle
process. You do not need to move the original process. Duplicating a whole
process from the tree still copies the whole process and its drilldowns.

Resources remain references to the same Portfolio resources. Connections to
unselected nodes are not copied. A node copied without its group is detached
from that group; source canvas lanes are not copied with selected nodes.
Lanes inside copied drilldowns are preserved. Missing or cyclic drilldowns
block copying with an error instead of creating broken references.

### Add and edit Events

Choose **Add Event** in the floating canvas tools when something occurs, is
observed or received, is emitted, or becomes true. This is different from an
Action, where someone or something performs work, and from a Decision, where
the flow chooses a path. Start and End remain separate structural node types.
A trigger is an Event whose connections cause later steps to proceed; it is not
a separate node type.

A new Event is **Generic** and **Neutral** with no date. Select it to edit its
title and description under **Identity**, then use **Event Kind** and
**Behavior** under **Event Details**:

- **Generic** is available when no more specific kind is needed.
- **Message** covers something received, such as an order or payment
  confirmation.
- **Signal** covers a published or received signal.
- **Condition** means that a condition becomes true, such as a temperature
  crossing a threshold.
- **Timer** covers an elapsed deadline or timeout.
- **Error** records an error occurrence.
- **Milestone** records a neutral occurrence such as a signed agreement.
- **Observed** means the process observes or receives the Event; **Emitted**
  means the process publishes it; **Neutral** simply records it.

Choose **Theme Color** under **Appearance** to override the Event's default
theme accent and border. The selected color also follows the Event's connector
handles and selection outline; without an override, the active theme supplies
the Event colors.

Open the optional **Timing** section only when the Event needs a date or time.
The node shows a calendar or clock and formatted timing only after a start or
end has been entered. **Remove timing** clears the facet without changing the
Event kind or behavior.

- **Precision** offers **Year**, **Month**, **Day**, and **Exact time**.
- A start without an end is a point in time. Start and end together form an
  interval; date interval endpoints are inclusive. An end without a start is
  shown as **Until** its end.
- **All-day event** is available for day-precision dates. Year and month values
  express only that precision and are not treated as all-day dates.
- **Exact time** stores a stable instant together with the displayed IANA time
  zone. The editor uses this device's local time zone; the same intended local
  time is reproduced in Nemoto and the offline viewer.
- Date-only values are never converted through UTC, so they do not move to the
  previous or next date in another time zone.
- An end earlier than its start, incompatible endpoint precision, an invalid
  date or time zone, and a skipped local time during a daylight-saving change
  are rejected with feedback. During an overlapping daylight-saving hour,
  Nemoto chooses the earlier occurrence deterministically.

Events support the normal canvas move, connect, copy, paste, duplicate,
delete, undo, redo, search, save, import, and export workflows. Full and
partial Nemoto files preserve their timing and extension data. The standalone
HTML viewer presents Events read-only and includes kind, behavior, and any
configured timing in the details panel. Recurrence, reminders, and
calendar-service synchronization are not part of this release.

### Reuse resources

**Resources** are reusable things such as roles, systems, documents, and
equipment. Create a resource once, then link it wherever it participates. You
can link one from the selected step's right panel or drag a resource to the
canvas. Removing a link from a step does not delete the resource itself.

Resource categories can be added and renamed. Deleting a category moves its
resources to **Uncategorized**. Deleting a resource that is already linked
requires confirmation and removes those links.

### Keep a Journal

**Journal** stores notes in notebooks and folders. Notes support formatted text,
tables, checklists, links, local images, tags, and linked context. Drag items in
the Journal tree to reorganize them. The built-in Quick Notes notebook cannot
be moved.

Use **Add** in **Linked Context** to connect a note to a process, step, resource,
another note, tag, or incident. References inserted inside the note can also
keep related context linked. Removing a manual link does not remove a reference
that is still present in the note itself.

Removing a tag from the tag list archives it but leaves it on existing notes.
Purging archived tags removes those tags from all notes and cannot be undone.
Journal edits use the same portfolio save state as process and resource edits.

## Canvas interaction and selection

Choose the pointer tool before selecting existing items.

- Click an item to select it and open its properties in the right panel.
- Drag over empty canvas space to select every item touched by the selection
  rectangle.
- Hold **Ctrl** while clicking to add an item to, or remove it from, the current
  selection.
- Drag any selected item to move the selection together. One Undo restores the
  whole move.
- Press **Ctrl+A** while the canvas has focus to select all canvas items. Edges
  are not included by this shortcut.
- Click empty canvas space to clear the selection.

Pan with two-finger trackpad scrolling or the mouse wheel. Middle-button drag
and **Space** + drag also pan the canvas. Pinch on a precision trackpad or use
**Ctrl + scroll** or the canvas controls to zoom, and use **Fit View** or **Reset View**,
depending on the layout, to bring the map back into view. Items snap to the
visible grid.

Double-click a step to edit its label. The caret starts at the end of the label,
and dragging across label text selects it without moving the step. Alt-double-click
a supported step to open its drilldown. Right-click a step for the actions that
apply to that item.

## Saving, backups, and recovery

### Where Nemoto keeps data

The installed Windows build keeps its primary working files under:

```text
%APPDATA%\nemoto\nemoto\config\
```

| Location | Purpose |
| --- | --- |
| `portfolio.json` | The active portfolio |
| `portfolio.json.bak` | The previous known-good save available to startup recovery |
| `config.json` | Core application configuration |
| `themes\` | One Nemoto-managed `.axiom-theme.json` copy per installed custom theme |
| `plugins\` and `plugin-runtime\` | Installed plugin packages and admitted runtime files on this device |
| `plugin-device-settings\` | Plugin settings that stay on this device |
| `plugin-secret-indexes\` | Secret names and metadata; secret values use the operating system credential store |

Nemoto keeps the active theme selection in `config.json` and installed custom
themes under `themes\`. UI preferences, the Local AI connection, and saved
Portfolio Chat conversations remain in device-local WebView storage. Full and
scheduled `.nemoto` files contain a non-canonical snapshot of only the active
appearance for reviewed restore. They do not copy the rest of the installed
theme library, UI preferences, Local AI configuration, or chat history.

The portable build redirects the primary Nemoto-managed files, including themes,
to a `data` folder beside `nemoto.exe`. Device-local WebView information remains
separate under `%LOCALAPPDATA%\com.joseph.nemoto`. Window state uses
`%APPDATA%\com.joseph.nemoto\.window-state.json`. Portable does not isolate
these locations or the operating-system credential store. A Portfolio restore
does not restore chat history, device settings, or the whole theme/plugin library. Use a `.nemoto` export to move the Portfolio and active appearance;
export other important custom themes separately.

### Save and back up

Nemoto periodically saves unsaved portfolio changes; the default interval is
about one minute. **Ctrl+S** requests an immediate save. A save error leaves the
portfolio marked as unsaved. Keep Nemoto open, retry the save, or create a manual
portfolio export before closing.

Scheduled backup is separate from automatic saving. Open **Settings → Data &
Backup** to:

- choose the backup directory;
- choose how often `.nemoto` snapshots are created;
- choose how many automatic snapshots are retained; and
- check when the last local backup was created.

Scheduled snapshots default to `Documents\NemotoBackups`. Retention removes only
older files named as automatic Nemoto backups; it does not remove manual
`.nemoto` exports. A custom active theme can add its embedded logo and font bytes
to every snapshot, up to the theme format's existing asset limits.

### Restore safely

Use **Settings → Data & Backup → Restore...** to replace the active portfolio
with a valid full `.nemoto` or legacy `.axiom` archive. Nemoto validates the selected data and writes
it safely before switching. The review dialog separately describes the included
appearance:

- a built-in theme can be activated or skipped;
- a new custom theme can be installed and activated or skipped;
- an identical installed theme can be reused;
- a different installed theme with the same stable ID is never replaced unless
  you explicitly choose **Replace it with backup copy**; and
- a broken or unsupported appearance snapshot is skipped without blocking
  Portfolio restore.

Theme installation happens only after the Portfolio has been restored. If that
optional step fails, the restored Portfolio remains available and the current
appearance stays active. For a new or replacement custom theme, Nemoto treats
the managed theme file and its active selection as one guarded operation. If
the active selection cannot be saved, the new file is removed or the exact
previous revision is restored. This is different from opening a temporary
import.

If the active portfolio cannot be opened, Nemoto stays on a safe startup screen.
Normal workspace editing and automatic saving do not start. Choose **Try again**,
or choose **Restore recovery file** when a validated recovery file is available.

Choose **Manage damaged processes** to inspect process names, descriptions,
validation errors and **Read process data**, even when a process cannot open.
Select entries to remove; none are selected automatically. The screen checks
the remaining portfolio and enables **Remove selected processes** only if it
passes schema and integrity validation. This preserves the complete original
file as `portfolio.before-repair-<unique-id>.json` beside `portfolio.json`, keeps
the normal `.bak` file unchanged, and saves the remaining data. The preserved
path is shown before you choose **Open repaired portfolio**.

Resources and Journal content are kept, including links to removed processes;
those links can become unresolved. Unsupported node types are not converted.
Inspection and checkbox changes do not write files. If the file changes during
review, choose **Reload process list** and select again. This check uses the
saved file itself; number formatting in the interface does not invalidate the
review. Malformed JSON,
unsupported future file versions, and errors outside the removed processes
still require a suitable backup; this is not a general data repair editor.

Closing with unsaved work offers save, close without saving, and cancel. If
saving fails, Nemoto remains open.

## Import and export

### Import resources from a table

Open **File → Import... → Resources**. Nemoto accepts CSV, TSV, TXT, Excel
`.xlsx`, resource JSON, or a pasted table.

Drop one file onto the source area, or click it to choose a file. File drops
also work in the Windows desktop app. Drops outside the source area are ignored.

1. Choose the source and, for a workbook, the sheet.
2. Select the column that contains the resource name and choose an existing
   category.
3. Enable the remaining columns you want as properties and check their names
   and detected types.
4. Review skipped empty names, duplicates, and invalid typed values before
   creating anything.

Duplicate matching ignores capitalization and surrounding spaces within the
chosen category. The default is to skip duplicates; you can instead create
them. Text imports are limited to 50 MB, 50,000 data rows, 250 columns, and
50,000 characters in one cell.

### Open another portfolio or process temporarily

**Portfolio or process** import accepts `.nemoto`, `.nemoto-process`, legacy `.axiom` and `.ax`, `.json`, and `.vsdx`.
Drop one file onto **Drop a Nemoto or Visio file here**, or click the area to
choose it. Dropped files go through the same validation as chosen files.
It opens as a read-only temporary reference first and does not replace the
active portfolio.

Preview it from **Temporary Imports** in the left panel. Merge supported
processes, resources, and Journal entries to keep them. Otherwise the reference
disappears when Nemoto closes or when you discard it. Visio and tabular conversion
can be partial, so review the preview and merged result.

The repository's [Lindhamn Service demo](../testdata/lindhamn-service/README.md)
provides a synthetic Swedish `.axiom` Portfolio with six processes, three
Journal notebooks and no plugin requirement. Start with **00 Börja här –
demonstrationsordning** in its Journal. Inspect it as a temporary reference;
use a disposable profile for full restore and release testing. External source
links are not embedded documents; the demo instructions themselves are offline.

### Choose an export

Open **File → Export...**:

| Goal | Visible choice | Format and contents |
| --- | --- | --- |
| Back up or move the complete portfolio | **Export Portfolio** | `.nemoto`; all Portfolio data plus a reviewed restore snapshot of the active appearance |
| Share the active process for editing in Nemoto | **Export Active Process** | `.nemoto-process`; the active process and its nested graphs, plus selected linked content |
| Share a view that opens without Nemoto | **Interactive HTML Viewer** | One standalone offline `.html` file with a read-only process viewer |

For `.nemoto-process` and HTML, **Include linked resources and shareable journal notes**
adds only content linked to the exported process. Unrelated portfolio content,
Internal notes, plugin data, device settings, Local AI settings, and Portfolio
Chat history are excluded. Clear the option to export the process graphs
without those linked resources and notes.

The HTML viewer works offline in a browser. It can navigate nested process
detail, show Event semantics and optional timing plus included resources and
notes, and switch to **Dependency Map** when linked content was included. It cannot edit the
embedded portfolio. Select and copy text in details, resource readers, and Journal
notes using the browser's usual copy command. Long reader content scrolls inside
its window. Text selection is enabled directly in resource and Journal readers,
including property values and code blocks. After viewer fixes, create a new HTML
export; an existing exported file keeps its original reader.
The details sidebar opens on selection; **Close details** hides it,
and selecting a node opens it again. Its **Download .nemoto-process**
button downloads the embedded process fragment for import into Nemoto.

Exported nodes show the same linked-content indicators as the Canvas: a box for
included resources and a document for included Journal notes. These also appear
in nested graphs. Omitted content, including Internal notes, does not create an
indicator. Select the node to find its linked content in the details panel.
Resource nodes open their reader directly; if the node also has linked notes,
close the reader to reach those notes in the details panel.

### Share Journal content deliberately

New Journal notes start as **Shareable**. Use the note's sharing control to
switch between **Shareable** and **Internal**:

- **Shareable** means the note may be included in `.nemoto-process` or HTML when it is
  linked to the exported process and linked content is enabled.
- **Internal** prevents the note from being included in `.nemoto-process` and HTML sharing
  exports.
- Both Shareable and Internal notes remain in the local portfolio and in a full
  `.nemoto` export.

**Internal is an export filter, not encryption or access control.** Anyone who
can open the local portfolio or a full `.nemoto` archive can read those notes.

## Themes

New profiles start in **Polar**; existing profiles keep their saved theme.
Choose a built-in theme under **Settings → Appearance**: **Void**, **Polar**, or
**Brutalist**.

Brutalist uses stronger row/column separators to distinguish them from its grid.
Polar gives the floating toolbar a continuous raised backdrop and decision
symbols a stronger outline.

Void uses the same 13 px semibold canvas node labels as Polar, including event
titles. Brutalist also uses 13 px labels while retaining its bold monospace
styling. Canvas zoom scales these labels; Void and Brutalist HTML exports retain
this sizing.
Brutalist uses palette-filled process nodes and uppercase process labels. Event
content uses a separate readable background while its header retains the accent.

Open **Theme Studio** to create a custom theme from a built-in baseline, edit
its visual tokens, preview it, and then **Save** and **Apply** it. Under
**Brand & Typography**, set the displayed product name, embed a PNG or WebP logo, and
embed a regular WOFF2 interface font. Each embedded file may be at most 2 MiB.
The embedded typeface is used consistently for the interface, display headings,
and process-node labels. Under **Visual Recipes**, choose among six optional
Core-rendered treatments: density, corners, elevation, controls, surfaces, and
process nodes. Density also changes rails, docks, menus, lists, and dialog rows.
Surface treatments are **Solid**, **Layered**, or **Translucent**; node treatments
are **Minimal**, **Outlined**, **Raised**, or **Graphic**. Leaving a recipe at
**Baseline default** preserves the selected built-in theme's own art direction.
Theme Studio can also duplicate or delete
a custom theme, import one from a file or pasted JSON, and download a reusable
`.axiom-theme.json` file. The top theme selector previews **Void**, **Polar**,
and **Brutalist** even when you have not created a custom theme. Every public
theme token appears in an element inspector. Changed token cards are marked,
and their **Reset** action restores only that token to the current baseline.
The three baseline buttons instead change the draft's art direction and reset
all public tokens; branding, embedded assets, typography, and visual recipes
remain unchanged. Save the result if you want to keep either kind of reset.

Turn off **Show display name** under **Brand & Typography** to show the logo
without adjacent product-name text. The stored name is retained, and the choice
applies to the app, preview and new HTML exports. Existing themes show the name
by default.

Without a custom logo, the app and HTML viewer use the Nemoto process-and-leaf
mark, with colours adapted to the active theme.

Logos retain their aspect ratio. Wide logos can use up to five times the logo
height in headers; extremely wide images are scaled to fit without cropping.
The logo inspector offers a larger preview. Transparent outer margins within
the image still take up space.

The full and compact Theme Studio previews include an Event. Event background,
border, text, and accent are Core semantic tokens, so custom themes can style
the Event without owning its process meaning, kind iconography, optional timing,
or rendering logic.

The two panel buttons above **Live Preview** hide or restore the Elements and
properties panels. At smaller supported window sizes, Elements automatically
becomes a compact icon rail; hover an icon to see its full name and description.
An **Unsaved** badge appears while the visible draft differs from its installed
file. **Save** is available only for a changed draft. If you switch themes, start
a new theme or import, or close Theme Studio while that badge is present, Nemoto
asks before discarding the draft.

Custom themes are canonically device-local. Full and scheduled `.nemoto`
backups also embed the active theme as a non-canonical restore snapshot; other
installed themes are not included. Restore presents stable-ID conflicts and
never replaces a local theme without an explicit choice. Export a theme file
separately when sharing it directly or moving a theme that is not active. Import
creates a Nemoto-managed local copy; the source file does not need to remain in
place. If its stable ID is already installed, Theme Studio asks whether to keep
the installed file or explicitly replace and activate the imported version.
Save writes the current draft, while Apply saves and activates it. An Interactive
HTML Viewer embeds the rendered custom theme that was active when the viewer was
created, including its embedded logo, font, display name, and supported visual
recipes, surface treatment, and node treatment. The viewer still shows Nemoto's
attribution in its footer.

Theme files use format version 2. Nemoto migrates version 1 files on import.
Future format versions are left untouched and reported as unsupported. Theme
Studio preserves supported fields that it cannot edit, including namespaced
`extensions`, when the file is saved or exported. Unknown recipe fields remain
stored but do not affect the interface until Nemoto Core supports them. Local
paths, remote logos, arbitrary CSS, and JavaScript are not theme runtime inputs.

## Plugins and safety

On canvas nodes, plugin actions appear after the standard Nemoto commands and
before **Delete**, in a separate group. Activating plugins keeps the standard
commands in their familiar order at the top of the menu.

Open **Settings → Plugins** and choose **Inspect package** to select an
`.axiom-plugin` file. Nemoto validates the package and shows its identity and
requested access before installation. Install packages only from a source you
trust, and grant only access that matches the package's purpose.

Plugin installation is device-local; activation is controlled separately for
each portfolio. Standard declarative plugins use views rendered by Nemoto. They
do not run their own JavaScript or directly edit processes, resources, or notes.

Executable packages can also provide interactive views. The package chooses
the fields, labels, actions and layout; Nemoto supplies shared controls, theme,
keyboard handling and permission checks. Package updates can add or rearrange
controls without a matching Nemoto update when they use supported controls.

Some packages can contain one isolated executable WebAssembly module. Nemoto
shows an additional risk and permission review before installation. These
packages can run only admitted commands with approved access. A proposed
portfolio change remains unchanged until Nemoto validates it and you explicitly
accept it in **Review**. Accepted changes can be undone.

Updated packages can use compact grouped choices, icon actions, cards, status
badges and responsive field rows while following your active theme. Icon actions
retain names for keyboard and screen-reader use. A package requiring an unsupported
UI feature is rejected during inspection; update Nemoto before installing it.

Deactivating or uninstalling a plugin keeps plugin-owned data already stored in
the portfolio. If a required compatible plugin is missing, its views remain
unavailable but that portfolio data is preserved.

Plugin settings and secrets stay on the device and are not included in
`.nemoto` files or scheduled Nemoto backups. Secret values use the operating
system credential store and are not displayed in Nemoto. **Settings → Plugins**
can permanently clear retained device data after confirmation.

After installing an updated plugin, activate it in **Settings → Plugins**. If the
Portfolio previously used another version, **Review plugin version change** shows
the old and installed versions and the number of validated saved records. Choose
**Use version and activate** to retain their contents and use the new version.
Save the Portfolio to keep the new requirement. **Cancel version change** leaves
its requirement and data unchanged; it does not undo package installation.

Nemoto validates all saved collection records against the installed package. A
changed data format, incompatible record or data without a declared compatibility
schema requires a migration instead. Nemoto leaves that data untouched. If the
Portfolio or installed package changes during review, review the change again.
Deactivation and uninstall preserve the last-used package/data requirement.

## Portfolio Chat

Portfolio Chat is an optional experimental feature for a local
OpenAI-compatible model. Configure it in **Settings → Local AI**, then open
**Chat** from the header. Nemoto accepts only a loopback endpoint on this device.

Choose the smallest useful scope: the current process, the current selection,
or the entire portfolio. Answers can be wrong even when their citations are
valid, so open important sources and verify the underlying work.

Portfolio Chat is read-only. It cannot directly change a process, resource, or
Journal note. Its connection settings and bounded conversation history stay on
this device and are not included in portfolio exports.

## Keyboard shortcuts

Global shortcuts work when the focused editor does not need the same key
combination.

| Shortcut | Action |
| --- | --- |
| **F1** | Open or close Help |
| **Ctrl+N** | New process |
| **Ctrl+Shift+N** | New folder |
| **Ctrl+K** | Search processes, resources, and notes |
| **Ctrl+S** | Save now |
| **Ctrl+J** | Open or close Journal |
| **Ctrl+Shift+J** | Create a quick note |
| **Escape** | Close the active dialog or leave a maximized Journal |

Dialogs appear above canvas and Journal context menus. A menu opened from within
a dialog appears above that dialog; **Escape** closes the menu first.

Clicking a connection line or its label gives the canvas keyboard focus, so
**Delete** or **Backspace** removes that selection. While editing text or using
a dropdown, these keys do not remove canvas items. **Ctrl+Z** restores a deleted
connection.

When the canvas has keyboard focus:

| Shortcut | Action |
| --- | --- |
| **Space** + drag | Pan the canvas |
| **Ctrl+A** | Select all canvas items, excluding edges |
| **Delete** or **Backspace** | Remove selected items or connections |
| **Ctrl+Z** | Undo |
| **Ctrl+Y** or **Ctrl+Shift+Z** | Redo |
| **Ctrl+C** / **Ctrl+V** | Copy / paste selected canvas items |

Inside the Journal editor, **Ctrl+F** or **Ctrl+H** opens find and replace, and
**Ctrl+K** edits a link instead of opening global search.

## Known limitations

- This release candidate is packaged and validated for Windows x64 only, and
  its installer is not code-signed.
- The interface is English. Swedish terms help with icon search but do not
  translate the interface.
- Release-candidate builds may contain defects. Keep a separate validated
  `.nemoto` backup of important work.
- A scheduled-backup failure is currently written to diagnostics rather than
  shown as an in-app alert. Check **Last local backup** and the backup folder
  before relying on the schedule.
- Local AI and Portfolio Chat are experimental and require a compatible local
  service that Nemoto does not install.
- Visio and tabular imports may need correction after conversion. Temporary
  imports are not retained unless their supported content is merged.
- The HTML viewer is for offline review, not editing. Download its `.nemoto-process` fragment
  and import that into Nemoto to make changes.
- **Internal** Journal notes are filtered from sharing exports but are not
  encrypted in the local portfolio or a full backup.
- The canvas toolbar currently displays **Toggle Grid**, but that control does
  not change the grid.
- External plugin packages are capability-limited. Packages that request an
  unsupported capability or external package dependency are rejected.

## Troubleshooting and safe mode

| Symptom | Safe next step |
| --- | --- |
| Nemoto cannot open the active portfolio | Choose **Manage damaged processes** to inspect and explicitly remove broken process entries with original-file preservation. **Try again** and **Restore recovery file** remain available. Auto-save is paused. |
| Saving fails | Keep Nemoto open. Check available disk space and access to the local data location, then retry **Ctrl+S** or make a manual `.nemoto` export. |
| Imported work disappears after restart | It was opened as a temporary reference. Import it again and merge the supported items you want to keep. |
| A plugin view is missing | Open **Settings → Plugins**. Install the compatible package if needed and activate it for this portfolio. Preserved plugin data is not deleted by the missing view. |
| A view reports an unexpected problem | Choose **Try reopening the view**. If the problem returns, restart Nemoto and use a validated recovery or backup only if the portfolio itself cannot open. |
| Help cannot be loaded | Close the fallback message and open Help again. The rest of Nemoto remains available. |

Avoid manually replacing `portfolio.json` while Nemoto is running. Use the
built-in Restore or recovery actions so the replacement is validated first.

## About Nemoto

**Nemoto version:** {{APP_VERSION}}

Nemoto is a local-first desktop workspace for mapping processes and connecting
them to reusable resources, roles, systems, documents, and notes. This release
candidate targets Windows x64 and uses an English interface.

**Publisher:** Kickflip Code

**Copyright:** © 2026 Kickflip Code

**Core license:** Mozilla Public License 2.0 (MPL-2.0).
Owner-authored plugins have a separate Apache-2.0 license; their publication
is deferred beyond this Core beta.

Release candidates may still contain defects. Keep a separate backup of
important work.
