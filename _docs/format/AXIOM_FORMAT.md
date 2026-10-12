# Nemoto compatibility identifiers

## Nemoto naming and stable contracts

New full exports use `.nemoto`; process fragments use `.nemoto-process`.
Readers also accept `.axiom` and `.ax`. Determine document kind from the decoded
content, not its filename. Both generations use `format: "axiom"`, the existing
wrapper alias and schema version 4; product branding does not increment schemas.
No existing archive or user-authored name is rewritten by the rename.

Internal source names now use Nemoto: `Nemoto*` components and types,
`NEMOTO_*` constant symbols, `nemoto-*` CSS/DOM hooks, generated font-family
names, `nemoto-data` / `<!--NEMOTO_DATA-->` viewer embedding, and internal
worker/harness names. Symbol renaming does not change a constant's serialized
value. The unused former logo component is removed; the approved `NemotoIcon`
remains. Previously exported HTML is self-contained and keeps its own viewer.

The authoring entry is `scripts/nemoto-plugin.mjs`; its helper and tests use
`nemoto-plugin-authoring.mjs` and `nemoto-plugin-cli.test.mjs`. The native
validator binary is `nemoto-plugin-validator`. These are source tools, not
package identities. The CLI still reads the existing project filename below.

### Compatibility identifiers retained after the source rename

| Retained identity | Reader/writer or consumer | Reason to keep it |
| --- | --- | --- |
| `.axiom`, `.ax`, `format: "axiom"`, legacy wrapper fields, `AXIOM` source prefix | Portfolio codec, import/restore, native path validation, viewer downloads | Existing Portfolio/process files remain readable; current exports retain the same format marker. |
| `.axiom-theme.json`, `axiom.theme`, `axiom.appearance` | Theme parser/repository and appearance backup/restore | Existing themes and embedded appearance snapshots keep their schema and file contract. |
| `.axiom-plugin`, `axiom.*` schema strings, `axiomPluginApi` | Manifest/package validation, host/guest protocol, stored transactions and portable records | Existing packages, records and recovery state remain valid. Rust's `axiom_plugin_api` serializes to this same field. |
| `org.axiom.*`, `axiom.core/*`, contribution/entity/theme IDs and grants | Package registry, authorization, references and stored plugin state | Identity changes would orphan data or change authority. Fixture IDs also exercise these legacy contracts. |
| `axiom-wasm-v1`, `axiom_abi_version`, `axiom_alloc`, `axiom_run`, `axiom-wasm-storage-generation-v1` | Native Wasm admission/host, SDK guests and storage integrity | Already compiled guest binaries and persisted storage must retain the exact ABI and digest inputs. |
| `axiom.plugin.{id}` | OS keyring service in plugin device storage | Existing secrets must remain addressable. |
| `axiom-settings`, `axiom-portfolio-chat-history`, `axiom-theme-library-v2`, `axiom-theme-migration-recovery-v1` | Settings/chat stores and browser theme repository/recovery | Device-local settings, history and recovery data must not disappear. The similarly named chat CSS class is now `nemoto-portfolio-chat-history`. |
| `backedUpByAxiom`, `write_axiom_file_atomic` | Device-storage API metadata; frontend/native atomic-write bridge | Keep existing API fields/command contracts; the frontend helper is now `writeNemotoFileAtomic`. The command is actively used. |
| `axiom-plugin.project.json`, `axiom-wasm-guest` and existing guest artifact/package names | Authoring CLI, SDK Cargo consumers, deferred package builds | Existing project inputs and package dependencies are distinct from Core's internal names. SDK publication/naming remains separately scoped. |
| `auto-backup-*.axiom`, historical `AxiomBackups` references | Backup retention and documented legacy source locations | Old backups remain recognizable; original source locations are not renamed in place. |

Authored content such as theme branding, package publisher names, fixture
content and historical evidence is not rewritten to match Core branding.
Changing an identity in this table requires a separately tested alias/migration
or an explicit new contract; a source-wide text replacement is not a migration.

New HTML exports identify Nemoto; downloads decode both AXIOM and NEMOTO source
prefixes. Import metadata displays the recorded version without inventing a
product attribution. New scheduled snapshots use `.nemoto`; retention recognizes
only timestamped `auto-backup-*.nemoto` and `auto-backup-*.axiom` files and keeps
its existing directory scopes. Neither suffix permits deleting arbitrary files.
