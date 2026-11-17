mod build_support;

fn main() {
    println!("cargo:rerun-if-changed=build_support.rs");
    let out_dir = std::env::var_os("OUT_DIR").expect("Cargo must provide OUT_DIR");
    build_support::prepare_java_resource_copy(std::path::Path::new(&out_dir))
        .unwrap_or_else(|error| panic!("Unable to prepare generated Java resources: {error}"));
    tauri_build::build();
}
