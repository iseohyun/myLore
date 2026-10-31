//! 모바일 동반 앱용 로컬 HTTP 서버(tiny_http, 포트 18443).
//!
//! 이 파일은 서버 기동과 URL 라우팅만 담당하며, 각 엔드포인트 처리는 `routes_*` 모듈의 `handle_*` 함수에 있습니다.

mod routes_core;
mod routes_media;
mod routes_sync;

use crate::*;

pub(crate) fn spawn_mobile_companion_http_server(
    app_handle: AppHandle,
    db_path: PathBuf,
    pending_cli_files: Arc<Mutex<Vec<String>>>,
) {
    thread::spawn(move || {
        // 서버 기동 즉시 로컬 네트워크(UDP 18444)에 PC 온라인 신호 브로드캐스트
        let _ = broadcast_udp_pc_online();

        if let Ok(server) = tiny_http::Server::http("0.0.0.0:18443") {
            for request in server.incoming_requests() {
                let app_handle = app_handle.clone();
                let db_path = db_path.clone();
                let pending_cli_files = pending_cli_files.clone();

                // 다운로드/동기화 요청과 미디어·열람 요청이 서로 블로킹하지 않도록 요청별 독립 스레드에서 처리
                thread::spawn(move || {
                    let request = request;
                    if request.method() == &tiny_http::Method::Options {
                        respond_json(request, 200, serde_json::json!({ "ok": true }));
                        return;
                    }

                    let raw_url = request.url().to_string();
                    let url_path = raw_url.split('?').next().unwrap_or("/");

                    if url_path == "/api/v1/open-files" {
                        routes_core::handle_open_files(request, app_handle, pending_cli_files);
                    } else if url_path == "/api/v1/status" || url_path == "/api/v1/sync/watermarks"
                    {
                        routes_core::handle_status_and_watermarks(request, db_path, url_path);
                    } else if url_path == "/api/v1/sync/manifest"
                        || url_path == "/api/v1/sync/reconcile"
                    {
                        routes_core::handle_sync_manifest_and_reconcile(
                            request, app_handle, db_path, url_path,
                        );
                    } else if url_path == "/api/v1/sync/session-plan" {
                        handle_session_plan(request, app_handle, db_path);
                    } else if url_path == "/api/v1/sync/complete" {
                        handle_sync_complete(request, app_handle, db_path);
                    } else if url_path == "/api/v1/sync/ack" {
                        handle_sync_ack(request, db_path);
                    } else if url_path == "/api/v1/sync/batch-init" {
                        routes_core::handle_batch_init(request, app_handle);
                    } else if url_path == "/api/v1/pair/confirm" {
                        routes_core::handle_pair_confirm(request, app_handle, db_path);
                    } else if url_path == "/api/v1/sync/check-hashes" {
                        routes_core::handle_check_hashes(request, db_path);
                    } else if url_path == "/api/v1/sync/notifications" {
                        routes_sync::handle_sync_notifications(request, db_path);
                    } else if url_path == "/api/v1/sync/sms" {
                        routes_sync::handle_sync_sms(request, db_path);
                    } else if url_path == "/api/v1/sync/call-logs" {
                        routes_sync::handle_sync_call_logs(request, db_path);
                    } else if url_path == "/api/v1/sync/kakao-chats" {
                        routes_sync::handle_sync_kakao_chats(request, db_path);
                    } else if url_path == "/api/v1/sync/contacts" {
                        routes_sync::handle_sync_contacts(request, db_path);
                    } else if url_path == "/api/v1/sync/app-usage" {
                        routes_sync::handle_sync_app_usage(request, db_path);
                    } else if url_path == "/api/v1/sync/call-recordings" {
                        routes_media::handle_sync_call_recordings(request, db_path);
                    } else if url_path == "/api/v1/sync/media" {
                        routes_media::handle_sync_media(request, db_path);
                    } else if url_path == "/api/v1/sync/samsung-health" {
                        routes_media::handle_sync_samsung_health(request, db_path);
                    } else if url_path == "/api/v1/local-media" {
                        routes_media::handle_local_media(request, db_path, &raw_url);
                    } else {
                        routes_media::handle_static_or_fallback(request, app_handle, url_path);
                    }
                });
            }
        }
    });
}
