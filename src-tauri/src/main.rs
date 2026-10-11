// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if nemoto_lib::plugin_wasm_admission::run_helper_if_requested() {
        return;
    }
    nemoto_lib::run()
}
