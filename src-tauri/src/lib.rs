pub mod commands;
pub mod error;
pub mod models;
pub mod plugin_compute_policy;
pub mod plugin_executable_package;
pub mod plugin_package_archive;
pub mod plugin_ui_protocol;
mod plugin_ui_rate;
pub mod plugin_wasm_admission;
pub mod plugin_wasm_data_plane;
pub mod plugin_wasm_host;
pub mod plugin_wasm_lifecycle;
pub mod plugin_wasm_session;
pub mod plugin_wasm_storage;
pub mod utils;

use commands::config::{get_active_theme, get_config, set_active_theme, set_config};
use commands::executable_plugins::{
    inspect_executable_plugin_package, install_executable_plugin_package,
    run_executable_plugin_proposal_command, run_executable_plugin_ui_reduction,
    synchronize_executable_plugin_authority, NativeExecutablePackageAdapter,
};
use commands::file::{load_project, save_project, write_axiom_file_atomic};
use commands::library::{load_library, save_library};
use commands::plugin_device_storage::{
    clear_plugin_device_storage, delete_plugin_device_secret, get_plugin_device_secret,
    list_plugin_device_storage, read_plugin_device_settings_state, read_plugin_secret_index,
    set_plugin_device_secret, transact_plugin_device_settings,
};
use commands::plugins::{install_plugin, list_installed_plugins, uninstall_plugin};
use commands::portfolio::{
    delete_temp_portfolio, has_portfolio_backup, list_temp_portfolios, load_portfolio,
    load_portfolio_backup, load_temp_portfolio, restore_portfolio_backup, save_portfolio,
    save_temp_portfolio, load_portfolio_for_repair, repair_portfolio_processes,
};
#[cfg(feature = "runtime-security-harness")]
use commands::runtime_security_harness::{
    prepare_packaged_tasks_variant, read_packaged_product_phase, rollback_packaged_tasks_to_a,
    run_packaged_executable_security_harness, write_packaged_product_phase,
    write_packaged_product_report,
};
use commands::themes::{
    delete_installed_theme, install_theme, list_installed_themes, restore_theme_and_activate,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let executable_packages = NativeExecutablePackageAdapter::native_for_app()
        .expect("executable package adapter could not be initialized");
    executable_packages
        .recover_all_pending()
        .expect("executable package transaction recovery failed");

    tauri::Builder::default()
        .manage(executable_packages)
        // Window chrome belongs to the build configuration, not a saved session.
        .plugin(tauri_plugin_window_state::Builder::default()
            .with_state_flags(tauri_plugin_window_state::StateFlags::all()
                & !tauri_plugin_window_state::StateFlags::DECORATIONS)
            .build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            // Config
            get_config,
            set_config,
            get_active_theme,
            set_active_theme,
            list_installed_themes,
            install_theme,
            restore_theme_and_activate,
            delete_installed_theme,
            // Legacy file commands (for backwards compatibility)
            load_project,
            save_project,
            write_axiom_file_atomic,
            // Library
            load_library,
            save_library,
            // Portfolio
            load_portfolio,
            load_portfolio_for_repair,
            repair_portfolio_processes,
            save_portfolio,
            has_portfolio_backup,
            load_portfolio_backup,
            restore_portfolio_backup,
            list_temp_portfolios,
            load_temp_portfolio,
            save_temp_portfolio,
            delete_temp_portfolio,
            // Declarative plugins
            list_installed_plugins,
            install_plugin,
            uninstall_plugin,
            inspect_executable_plugin_package,
            install_executable_plugin_package,
            synchronize_executable_plugin_authority,
            run_executable_plugin_proposal_command,
            run_executable_plugin_ui_reduction,
            read_plugin_device_settings_state,
            transact_plugin_device_settings,
            read_plugin_secret_index,
            get_plugin_device_secret,
            set_plugin_device_secret,
            delete_plugin_device_secret,
            list_plugin_device_storage,
            clear_plugin_device_storage,
            #[cfg(feature = "runtime-security-harness")]
            run_packaged_executable_security_harness,
            #[cfg(feature = "runtime-security-harness")]
            prepare_packaged_tasks_variant,
            #[cfg(feature = "runtime-security-harness")]
            rollback_packaged_tasks_to_a,
            #[cfg(feature = "runtime-security-harness")]
            read_packaged_product_phase,
            #[cfg(feature = "runtime-security-harness")]
            write_packaged_product_phase,
            #[cfg(feature = "runtime-security-harness")]
            write_packaged_product_report,
            // DevTools
            open_devtools
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
fn open_devtools(window: tauri::WebviewWindow) {
    #[cfg(debug_assertions)]
    window.open_devtools();

    #[cfg(not(debug_assertions))]
    let _ = window; // DevTools disabled in release builds
}
