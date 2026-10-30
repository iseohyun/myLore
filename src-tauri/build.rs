fn main() {
    println!("cargo:rerun-if-changed=../dist");
    println!("cargo:rerun-if-changed=../dist/index.html");
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=icons/icon.png");
    tauri_build::build();

    // `cargo test --lib` 테스트 실행 파일에도 Windows 리소스(Common Controls v6 매니페스트 포함)를 링크할 수 있도록
    // tauri-build가 만든 `libresource.a`의 위치를 라이브러리 검색 경로에 추가합니다.
    // 실제 링크는 lib.rs의 `#[cfg(test)] #[link(name = "resource", ...)]`가 테스트 빌드에서만 수행합니다.
    // (tauri-build는 bin 대상에만 리소스를 링크하므로, 테스트 바이너리에서 comctl32 v5가 로드되어
    //  `TaskDialogIndirect` 진입점 누락(STATUS_ENTRYPOINT_NOT_FOUND)이 발생하는 문제를 막습니다.)
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("gnu") {
        if let Ok(out_dir) = std::env::var("OUT_DIR") {
            if std::path::Path::new(&out_dir).join("libresource.a").exists() {
                println!("cargo:rustc-link-search=native={}", out_dir);
            }
        }
    }
}
