use std::{env, ffi::OsString, io, path::PathBuf, process::ExitCode};

use nemoto_lib::{
    plugin_executable_package::{
        ExecutablePackageAdapter, ExecutablePackageError, ExecutablePackageReview,
    },
    plugin_wasm_admission::{
        run_helper_if_requested, NativeWasmAdmission, WasmAdmissionError, WasmAdmissionReceipt,
    },
};
use serde::Serialize;

const VALIDATION_SCHEMA: &str = "axiom.executable-plugin-validation";
const VALIDATION_SCHEMA_VERSION: u32 = 1;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ValidationSuccess {
    schema: &'static str,
    schema_version: u32,
    valid: bool,
    package: ExecutablePackageReview,
    wasm_admission: WasmAdmissionReceipt,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ValidationFailure<T: Serialize> {
    schema: &'static str,
    schema_version: u32,
    valid: bool,
    stage: &'static str,
    error: T,
}

fn write_json(value: &impl Serialize, to_stderr: bool) {
    if to_stderr {
        let mut output = io::stderr().lock();
        let _ = serde_json::to_writer_pretty(&mut output, value);
        eprintln!();
    } else {
        let mut output = io::stdout().lock();
        let _ = serde_json::to_writer_pretty(&mut output, value);
        println!();
    }
}

fn usage_failure(message: &'static str) -> ExitCode {
    write_json(
        &ValidationFailure {
            schema: VALIDATION_SCHEMA,
            schema_version: VALIDATION_SCHEMA_VERSION,
            valid: false,
            stage: "usage",
            error: serde_json::json!({ "message": message }),
        },
        true,
    );
    ExitCode::from(2)
}

fn package_failure(error: ExecutablePackageError) -> ExitCode {
    write_json(
        &ValidationFailure {
            schema: VALIDATION_SCHEMA,
            schema_version: VALIDATION_SCHEMA_VERSION,
            valid: false,
            stage: "package",
            error,
        },
        true,
    );
    ExitCode::FAILURE
}

fn admission_failure(error: WasmAdmissionError) -> ExitCode {
    write_json(
        &ValidationFailure {
            schema: VALIDATION_SCHEMA,
            schema_version: VALIDATION_SCHEMA_VERSION,
            valid: false,
            stage: "wasmAdmission",
            error,
        },
        true,
    );
    ExitCode::FAILURE
}

fn validator_path(arguments: impl Iterator<Item = OsString>) -> Result<PathBuf, ExitCode> {
    let mut arguments = arguments;
    let Some(argument) = arguments.next() else {
        return Err(usage_failure(
            "Pass exactly one .axiom-plugin archive path.",
        ));
    };
    if argument == "--help" || argument == "-h" {
        println!(
            "Usage: axiom-plugin-validator <path-to-plugin.axiom-plugin>\n\
             Validates the executable package and runs native Wasm admission without installing it."
        );
        return Err(ExitCode::SUCCESS);
    }
    if arguments.next().is_some() {
        return Err(usage_failure(
            "Pass exactly one .axiom-plugin archive path.",
        ));
    }
    Ok(PathBuf::from(argument))
}

fn main() -> ExitCode {
    if run_helper_if_requested() {
        return ExitCode::SUCCESS;
    }

    let path = match validator_path(env::args_os().skip(1)) {
        Ok(path) => path,
        Err(code) => return code,
    };
    let inspection = match ExecutablePackageAdapter::<NativeWasmAdmission>::inspect_file(&path) {
        Ok(inspection) => inspection,
        Err(error) => return package_failure(error),
    };
    let wasm_admission = match inspection.validate_native_wasm() {
        Ok(receipt) => receipt,
        Err(error) => return admission_failure(error),
    };
    write_json(
        &ValidationSuccess {
            schema: VALIDATION_SCHEMA,
            schema_version: VALIDATION_SCHEMA_VERSION,
            valid: true,
            package: inspection.review(),
            wasm_admission,
        },
        false,
    );
    ExitCode::SUCCESS
}
