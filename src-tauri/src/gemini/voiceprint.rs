//! 2종 오픈소스 성문 모델(`3D-Speaker CAM++` 192D + `WeSpeaker ResNet34-LM` 256D) 기반
//! 음성지문(Voiceprint) 생성 · 교차검증 · 텍스트(JSON) 열람/편집 · Sync 연동 모듈.
//!
//! - **서버에서 녹음 (`user_server_mic`)**: PC 마이크(또는 로컬 오디오)로 가이드 문구/자유 발화를 녹음하며 실시간 교차검증 수렴도 측정
//! - **Sync 앱에서 녹음 (`user_sync_mobile`)**: Android Sync 앱 마이크 녹음 HTTP 엔드포인트(`/api/v1/voiceprint/enroll`) 연동

use crate::*;

pub(crate) const MODEL_A_FILENAME: &str = "3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx";
pub(crate) const MODEL_B_FILENAME: &str = "wespeaker_en_voxceleb_resnet34_LM.onnx";
pub(crate) const MODEL_A_LABEL: &str = "3D-Speaker CAM++ (192D · 단문/동아시아 음색 특화)";
pub(crate) const MODEL_B_LABEL: &str = "WeSpeaker ResNet34-LM (256D · 글로벌 성대 공명 특화)";

const PYTHON_DUAL_EXTRACTOR_SCRIPT: &str = r#"
import sys, os, json, subprocess, tempfile
os.environ["OMP_NUM_THREADS"] = "2"
os.environ["MKL_NUM_THREADS"] = "2"
os.environ["OPENBLAS_NUM_THREADS"] = "2"
os.environ["NUMEXPR_NUM_THREADS"] = "2"
import numpy as np
import soundfile as sf
import sherpa_onnx

def to_wav_16k(input_path, ffmpeg_bin, simulate_telephony=False):
    tmp_wav = tempfile.mktemp(suffix=".wav")
    cmd = [ffmpeg_bin, "-y", "-threads", "1", "-i", input_path]
    if simulate_telephony:
        cmd += ["-af", "highpass=f=300,lowpass=f=3400"]
    cmd += ["-ac", "1", "-ar", "16000", "-vn", tmp_wav]
    cflags = (0x08000000 | 0x00000040) if os.name == "nt" else 0
    subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True, creationflags=cflags)
    samples, sr = sf.read(tmp_wav, dtype="float32")
    try:
        os.remove(tmp_wav)
    except Exception:
        pass
    if samples.ndim > 1:
        samples = samples[:, 0]
    return samples, sr

def compute_emb(extractor, samples, sr=16000):
    stream = extractor.create_stream()
    stream.accept_waveform(sr, samples)
    stream.input_finished()
    if not extractor.is_ready(stream):
        return None
    vec = extractor.compute(stream)
    arr = np.array(vec, dtype=np.float64)
    norm = float(np.linalg.norm(arr))
    if norm > 1e-9:
        arr = arr / norm
    return arr.tolist()

def filter_active_speech(samples, sr=16000):
    frame_len = int(sr * 0.05)
    if len(samples) < frame_len * 2:
        return samples
    voiced = []
    for i in range(0, len(samples) - frame_len, frame_len):
        chunk = samples[i:i+frame_len]
        rms = float(np.sqrt(np.mean(chunk * chunk)))
        if rms > 0.008:
            voiced.append(chunk)
    if len(voiced) >= 6:
        return np.concatenate(voiced)
    return samples

def main():
    raw_in = sys.stdin.buffer.read().decode("utf-8")
    req = json.loads(raw_in)
    mode = req.get("mode", "extract")
    audio_path = req["audio_path"]
    model_a = req["model_a"]
    model_b = req["model_b"]
    ffmpeg_bin = req.get("ffmpeg_bin", "ffmpeg")
    sim_tel = bool(req.get("simulate_telephony", False))

    samples, sr = to_wav_16k(audio_path, ffmpeg_bin, simulate_telephony=sim_tel)
    duration_sec = float(len(samples)) / float(sr) if sr > 0 else 0.0

    if mode == "realign_time_only":
        ext_a, ext_b = None, None
        emb_a, emb_b = [], []
    else:
        ext_a = sherpa_onnx.SpeakerEmbeddingExtractor(
            sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=model_a, num_threads=1)
        )
        ext_b = sherpa_onnx.SpeakerEmbeddingExtractor(
            sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=model_b, num_threads=1)
        )
        voiced_samples = filter_active_speech(samples, sr)
        if len(voiced_samples) < int(sr * 0.35):
            voiced_samples = samples
        emb_a = compute_emb(ext_a, voiced_samples, sr)
        emb_b = compute_emb(ext_b, voiced_samples, sr)
        if emb_a is None or emb_b is None:
            print(json.dumps({"ok": False, "error": "유효한 음성 구간이 너무 짧아 성문을 추출할 수 없습니다 (최소 0.5초 이상 발화 필요)."}))
            return

    out = {
        "ok": True,
        "duration_sec": round(duration_sec, 2),
        "embedding_a": [round(float(x), 6) for x in emb_a],
        "embedding_b": [round(float(x), 6) for x in emb_b],
        "segments": [],
        "asr_utterances": []
    }

    if mode == "diarize_test":
        win_sec = 2.5
        step_sec = max(1.5, duration_sec / 120.0)
        win_n = int(win_sec * sr)
        step_n = max(int(1.2 * sr), int(step_sec * sr))
        segs = []
        idx = 0
        pos = 0
        while pos + int(0.8 * sr) <= len(samples) and idx < 160:
            end_pos = min(pos + win_n, len(samples))
            sub = samples[pos:end_pos]
            rms = float(np.sqrt(np.mean(sub * sub)))
            if rms > 0.007:
                sa = compute_emb(ext_a, sub, sr)
                sb = compute_emb(ext_b, sub, sr)
                if sa is not None and sb is not None:
                    segs.append({
                        "index": idx, "start_sec": round(pos / sr, 2), "end_sec": round(end_pos / sr, 2),
                        "embedding_a": [round(float(x), 6) for x in sa],
                        "embedding_b": [round(float(x), 6) for x in sb]
                    })
                    idx += 1
            pos += step_n
        out["segments"] = segs

    if mode == "asr_diarize":
        try:
            from faster_whisper import WhisperModel
            w_model = WhisperModel("small", device="cpu", compute_type="int8", cpu_threads=2, num_workers=1)
            w_segs, _ = w_model.transcribe(samples, language="ko", word_timestamps=True, vad_filter=True)
            words = []
            for ws in w_segs:
                if ws.words:
                    for w in ws.words:
                        wt = (w.word or "").strip()
                        if wt:
                            words.append((float(w.start), float(w.end), wt))
                elif (ws.text or "").strip():
                    words.append((float(ws.start), float(ws.end), ws.text.strip()))
            utts = []
            cur_w = []
            for (ws_t, we_t, wt) in words:
                if not cur_w:
                    cur_w.append((ws_t, we_t, wt))
                else:
                    prev_end = cur_w[-1][1]
                    prev_txt = cur_w[-1][2]
                    gap = ws_t - prev_end
                    span = we_t - cur_w[0][0]
                    ends_sent = prev_txt.endswith((".", "?", "!"))
                    if gap >= 0.42 or (ends_sent and (gap >= 0.16 or span >= 1.8)) or span >= 8.5:
                        utts.append((cur_w[0][0], cur_w[-1][1], " ".join(x[2] for x in cur_w)))
                        cur_w = [(ws_t, we_t, wt)]
                    else:
                        cur_w.append((ws_t, we_t, wt))
            if cur_w:
                utts.append((cur_w[0][0], cur_w[-1][1], " ".join(x[2] for x in cur_w)))

            asr_out = []
            segs = []
            for u_i, (u_st, u_en, u_txt) in enumerate(utts):
                pad_s = max(0.0, u_st - 0.15) if (u_en - u_st) < 1.2 else u_st
                pad_e = min(duration_sec, u_en + 0.15) if (u_en - u_st) < 1.2 else u_en
                s_i = max(0, int(pad_s * sr))
                e_i = min(len(samples), max(s_i + int(0.55 * sr), int(pad_e * sr)))
                sub = samples[s_i:e_i]
                sa = compute_emb(ext_a, sub, sr) if len(sub) >= int(0.4 * sr) else None
                sb = compute_emb(ext_b, sub, sr) if len(sub) >= int(0.4 * sr) else None
                ea_list = [round(float(x), 6) for x in sa] if sa else []
                eb_list = [round(float(x), 6) for x in sb] if sb else []
                asr_out.append({
                    "index": u_i, "start_sec": round(u_st, 2), "end_sec": round(u_en, 2), "text": u_txt,
                    "embedding_a": ea_list,
                    "embedding_b": eb_list
                })
                if ea_list and eb_list:
                    segs.append({
                        "index": len(segs), "start_sec": round(u_st, 2), "end_sec": round(u_en, 2),
                        "embedding_a": ea_list,
                        "embedding_b": eb_list
                    })
            out["asr_utterances"] = asr_out
            out["segments"] = segs
        except Exception as e:
            out["asr_error"] = str(e)

    if mode in ("realign_time_only", "realign_time_speaker"):
        in_utts = req.get("input_utterances") or []
        f_len = max(1, int(sr * 0.05))
        n_frames = max(1, len(samples) // f_len)
        weights = []
        for fi in range(n_frames):
            ch = samples[fi*f_len:(fi+1)*f_len]
            rms = float(np.sqrt(np.mean(ch * ch))) if len(ch) > 0 else 0.0
            weights.append(1.0 if rms > 0.006 else 0.04)
        cdf = np.cumsum(weights)
        total_w = float(cdf[-1]) if len(cdf) > 0 else 1.0
        char_lens = [max(2, len((u.get("text") or "").strip())) for u in in_utts]
        tot_chars = max(1, sum(char_lens))
        acc_c = 0
        asr_out, segs = [], []
        for u_i, u_obj in enumerate(in_utts):
            u_txt = (u_obj.get("text") or "").strip()
            r0 = acc_c / tot_chars
            acc_c += char_lens[u_i]
            r1 = acc_c / tot_chars
            f0 = int(np.searchsorted(cdf, r0 * total_w))
            f1 = int(np.searchsorted(cdf, r1 * total_w))
            u_st = min(duration_sec, max(0.0, (f0 * f_len) / float(sr)))
            u_en = min(duration_sec, max(u_st + 0.4, ((f1 + 1) * f_len) / float(sr)))
            ea_list, eb_list = [], []
            if mode == "realign_time_speaker":
                s_i = max(0, int(max(0.0, u_st - 0.1) * sr))
                e_i = min(len(samples), max(s_i + int(0.55 * sr), int(min(duration_sec, u_en + 0.1) * sr)))
                sub = samples[s_i:e_i]
                sa = compute_emb(ext_a, sub, sr) if len(sub) >= int(0.4 * sr) else None
                sb = compute_emb(ext_b, sub, sr) if len(sub) >= int(0.4 * sr) else None
                ea_list = [round(float(x), 6) for x in sa] if sa else []
                eb_list = [round(float(x), 6) for x in sb] if sb else []
                if ea_list and eb_list:
                    segs.append({"index": len(segs), "start_sec": round(u_st, 2), "end_sec": round(u_en, 2), "embedding_a": ea_list, "embedding_b": eb_list})
            asr_out.append({"index": u_i, "start_sec": round(u_st, 2), "end_sec": round(u_en, 2), "text": u_txt, "embedding_a": ea_list, "embedding_b": eb_list})
        out["asr_utterances"] = asr_out
        out["segments"] = segs

    print(json.dumps(out))

if __name__ == "__main__":
    main()
"#;

pub(crate) fn resolve_voiceprint_models_dir() -> PathBuf {
    if let Ok(appdata) = std::env::var("APPDATA") {
        let dir = Path::new(&appdata).join("com.iseohyun.mylore").join("voiceprint_models");
        let _ = fs::create_dir_all(&dir);
        return dir;
    }
    let fallback = PathBuf::from("voiceprint_models");
    let _ = fs::create_dir_all(&fallback);
    fallback
}

pub(crate) fn resolve_python_executable() -> Option<String> {
    if let Ok(local_app) = std::env::var("LOCALAPPDATA") {
        for sub in [r"Programs\Python\Python312\python.exe", r"Programs\Python\Python311\python.exe"] {
            let p = Path::new(&local_app).join(sub);
            if p.is_file() {
                return Some(p.to_string_lossy().to_string());
            }
        }
    }
    Some("python".to_string())
}

pub(crate) fn resolve_ffmpeg_executable() -> String {
    for c in [
        r"C:\Program Files\ffmpeg-8.1.2-essentials_build\bin\ffmpeg.exe",
        r"C:\ffmpeg\bin\ffmpeg.exe",
    ] {
        if Path::new(c).is_file() {
            return c.to_string();
        }
    }
    "ffmpeg".to_string()
}

pub(crate) fn cosine_similarity_vec(a: &[f64], b: &[f64]) -> f64 {
    if a.is_empty() || a.len() != b.len() {
        return 0.0;
    }
    let (mut dot, mut na, mut nb) = (0.0f64, 0.0f64, 0.0f64);
    for (x, y) in a.iter().zip(b.iter()) {
        dot += x * y;
        na += x * x;
        nb += y * y;
    }
    if na <= 1e-12 || nb <= 1e-12 {
        return 0.0;
    }
    (dot / (na.sqrt() * nb.sqrt())).clamp(-1.0, 1.0)
}

pub(crate) fn l2_normalize_vec(v: &[f64]) -> (Vec<f64>, f64) {
    let norm = v.iter().map(|x| x * x).sum::<f64>().sqrt();
    if norm <= 1e-12 {
        return (v.to_vec(), 0.0);
    }
    let out = v
        .iter()
        .map(|x| ((x / norm) * 1_000_000.0).round() / 1_000_000.0)
        .collect();
    (out, (norm * 10000.0).round() / 10000.0)
}

#[derive(Deserialize)]
pub(crate) struct PySegmentRaw {
    #[allow(dead_code)]
    #[serde(default)]
    pub(crate) index: usize,
    pub(crate) start_sec: f64,
    pub(crate) end_sec: f64,
    pub(crate) embedding_a: Vec<f64>,
    pub(crate) embedding_b: Vec<f64>,
}

#[derive(Deserialize)]
pub(crate) struct PyAsrUtteranceRaw {
    #[allow(dead_code)]
    #[serde(default)]
    pub(crate) index: usize,
    pub(crate) start_sec: f64,
    pub(crate) end_sec: f64,
    pub(crate) text: String,
    #[serde(default)]
    pub(crate) embedding_a: Vec<f64>,
    #[serde(default)]
    pub(crate) embedding_b: Vec<f64>,
}

#[derive(Deserialize)]
pub(crate) struct PyExtractResponse {
    pub(crate) ok: bool,
    pub(crate) error: Option<String>,
    #[serde(default)]
    pub(crate) duration_sec: f64,
    #[serde(default)]
    pub(crate) embedding_a: Vec<f64>,
    #[serde(default)]
    pub(crate) embedding_b: Vec<f64>,
    #[serde(default)]
    pub(crate) segments: Vec<PySegmentRaw>,
    #[serde(default)]
    pub(crate) asr_utterances: Vec<PyAsrUtteranceRaw>,
}

pub(crate) fn run_dual_model_extractor(
    audio_path: &Path,
    mode: &str,
    simulate_telephony: bool,
) -> Result<PyExtractResponse, String> {
    run_dual_model_extractor_with_utts(audio_path, mode, simulate_telephony, None)
}

static PYTHON_ASR_LOCK: std::sync::OnceLock<Mutex<()>> = std::sync::OnceLock::new();

pub(crate) fn run_dual_model_extractor_with_utts(
    audio_path: &Path,
    mode: &str,
    simulate_telephony: bool,
    input_utterances: Option<serde_json::Value>,
) -> Result<PyExtractResponse, String> {
    // 무거운 Whisper/ONNX 추론이 동시에 여러 개 실행되어 본체 UI/오디오 재생을 방해하지 않도록 직렬화
    let _asr_guard = if mode == "asr_diarize" {
        Some(
            PYTHON_ASR_LOCK
                .get_or_init(|| Mutex::new(()))
                .lock()
                .unwrap_or_else(|e| e.into_inner()),
        )
    } else {
        None
    };

    let py_bin = resolve_python_executable().ok_or_else(|| "Python 실행 파일을 찾을 수 없습니다.".to_string())?;
    let models_dir = resolve_voiceprint_models_dir();
    let model_a = models_dir.join(MODEL_A_FILENAME);
    let model_b = models_dir.join(MODEL_B_FILENAME);
    if !model_a.is_file() || !model_b.is_file() {
        return Err(format!("성문 추출 ONNX 모델 파일이 없습니다 ({}).", models_dir.display()));
    }
    let script_path = models_dir.join("dual_voiceprint_extractor.py");
    let _ = fs::write(&script_path, PYTHON_DUAL_EXTRACTOR_SCRIPT.as_bytes());
    let req_json = serde_json::json!({
        "mode": mode,
        "audio_path": audio_path.to_string_lossy().to_string(),
        "model_a": model_a.to_string_lossy().to_string(),
        "model_b": model_b.to_string_lossy().to_string(),
        "ffmpeg_bin": resolve_ffmpeg_executable(),
        "simulate_telephony": simulate_telephony,
        "input_utterances": input_utterances.unwrap_or(serde_json::Value::Null),
    });

    use std::io::Write;
    use std::process::Stdio;
    let mut child = Command::new(&py_bin)
        .arg(&script_path)
        .env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .env("OMP_NUM_THREADS", "2")
        .env("MKL_NUM_THREADS", "2")
        .env("OPENBLAS_NUM_THREADS", "2")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .creation_flags(CREATE_NO_WINDOW | 0x00000040) // IDLE_PRIORITY_CLASS: 본체 UI 및 포그라운드 앱 최우선 보장
        .spawn()
        .map_err(|e| format!("Python 성문 엔진 실행 오류: {}", e))?;
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(req_json.to_string().as_bytes());
    }
    let output = child.wait_with_output().map_err(|e| format!("Python 성문 엔진 대기 오류: {}", e))?;
    let stdout_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr_str = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let last_line = stdout_str.lines().last().unwrap_or("");
    if last_line.is_empty() {
        return Err(format!("성문 추출기 응답 없음 (stderr: {})", if stderr_str.is_empty() { "없음" } else { &stderr_str }));
    }
    let parsed: PyExtractResponse = serde_json::from_str(last_line)
        .map_err(|e| format!("성문 JSON 파싱 실패 ({}): {}", e, last_line))?;
    if !parsed.ok {
        return Err(parsed.error.unwrap_or_else(|| "성문 추출 실패".to_string()));
    }
    Ok(parsed)
}

fn empty_voiceprint_profile(profile_id: &str, display_name: &str, source_mode: &str) -> VoiceprintProfileItem {
    let raw_obj = serde_json::json!({
        "profileId": profile_id, "displayName": display_name, "sourceMode": source_mode,
        "modelA": { "name": MODEL_A_LABEL, "dim": 192, "embedding": [] },
        "modelB": { "name": MODEL_B_LABEL, "dim": 256, "embedding": [] },
        "sampleCount": 0, "consistencyA": 0.0, "consistencyB": 0.0, "crossAgreementScore": 0.0, "updatedAt": ""
    });
    VoiceprintProfileItem {
        profile_id: profile_id.to_string(), target_type: "user".to_string(),
        display_name: display_name.to_string(), source_mode: source_mode.to_string(),
        model_a_name: MODEL_A_LABEL.to_string(), model_b_name: MODEL_B_LABEL.to_string(),
        dim_a: 192, dim_b: 256, norm_a: 0.0, norm_b: 0.0,
        embedding_a: Vec::new(), embedding_b: Vec::new(),
        sample_count: 0, consistency_a: 0.0, consistency_b: 0.0, cross_agreement_score: 0.0,
        samples_meta: Vec::new(), raw_json_text: serde_json::to_string_pretty(&raw_obj).unwrap_or_default(),
        updated_at: String::new(),
    }
}

pub(crate) fn load_voiceprint_profile(
    conn: &Connection, profile_id: &str, default_name: &str, default_mode: &str,
) -> VoiceprintProfileItem {
    let row_opt = conn
        .query_row(
            "SELECT display_name, source_mode, model_a_name, model_b_name, embedding_a_json, embedding_b_json,
                    sample_count, consistency_a, consistency_b, cross_agreement_score, samples_meta_json, updated_at
             FROM voiceprint_profiles WHERE profile_id = ?1",
            params![profile_id],
            |r| Ok((
                r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?,
                r.get::<_, String>(4)?, r.get::<_, String>(5)?, r.get::<_, i64>(6)?, r.get::<_, f64>(7)?,
                r.get::<_, f64>(8)?, r.get::<_, f64>(9)?, r.get::<_, String>(10)?, r.get::<_, String>(11)?,
            )),
        )
        .optional()
        .unwrap_or(None);

    let Some((d_name, s_mode, m_a, m_b, emb_a_str, emb_b_str, s_cnt, con_a, con_b, cross_sc, meta_str, upd_at)) = row_opt else {
        return empty_voiceprint_profile(profile_id, default_name, default_mode);
    };
    let emb_a: Vec<f64> = serde_json::from_str(&emb_a_str).unwrap_or_default();
    let emb_b: Vec<f64> = serde_json::from_str(&emb_b_str).unwrap_or_default();
    let samples_meta: Vec<VoiceprintSampleMeta> = serde_json::from_str(&meta_str).unwrap_or_default();
    let (_, norm_a) = l2_normalize_vec(&emb_a);
    let (_, norm_b) = l2_normalize_vec(&emb_b);
    let raw_obj = serde_json::json!({
        "profileId": profile_id, "displayName": d_name, "sourceMode": s_mode, "sampleCount": s_cnt,
        "consistencyA": con_a, "consistencyB": con_b, "crossAgreementScore": cross_sc, "updatedAt": upd_at,
        "modelA": { "name": m_a, "dim": emb_a.len(), "l2Norm": norm_a, "embedding": emb_a },
        "modelB": { "name": m_b, "dim": emb_b.len(), "l2Norm": norm_b, "embedding": emb_b },
        "samplesHistory": samples_meta,
    });
    VoiceprintProfileItem {
        profile_id: profile_id.to_string(), target_type: "user".to_string(),
        display_name: d_name, source_mode: s_mode, model_a_name: m_a, model_b_name: m_b,
        dim_a: emb_a.len(), dim_b: emb_b.len(), norm_a, norm_b, embedding_a: emb_a, embedding_b: emb_b,
        sample_count: s_cnt.max(0) as usize, consistency_a: con_a, consistency_b: con_b,
        cross_agreement_score: cross_sc, samples_meta,
        raw_json_text: serde_json::to_string_pretty(&raw_obj).unwrap_or_default(), updated_at: upd_at,
    }
}

fn build_combined_master_profile(
    server_prof: &VoiceprintProfileItem,
    sync_prof: &VoiceprintProfileItem,
) -> (VoiceprintProfileItem, f64, f64, f64) {
    let has_srv = !server_prof.embedding_a.is_empty() && !server_prof.embedding_b.is_empty();
    let has_sync = !sync_prof.embedding_a.is_empty() && !sync_prof.embedding_b.is_empty();

    if !has_srv && !has_sync {
        return (
            empty_voiceprint_profile("user_master_combined", "통합 마스터 음성지문 (서버 + Sync)", "hybrid"),
            0.0,
            0.0,
            0.0,
        );
    }
    if has_srv && !has_sync {
        let mut c = server_prof.clone();
        c.profile_id = "user_master_combined".to_string();
        c.display_name = "통합 마스터 음성지문 (서버 단독)".to_string();
        return (c, 0.0, 0.0, 0.0);
    }
    if !has_srv && has_sync {
        let mut c = sync_prof.clone();
        c.profile_id = "user_master_combined".to_string();
        c.display_name = "통합 마스터 음성지문 (Sync 단독)".to_string();
        return (c, 0.0, 0.0, 0.0);
    }

    let sim_a = cosine_similarity_vec(&server_prof.embedding_a, &sync_prof.embedding_a);
    let sim_b = cosine_similarity_vec(&server_prof.embedding_b, &sync_prof.embedding_b);
    let cross_score = ((sim_a + sim_b) * 0.5 * 1000.0).round() / 10.0;

    // 통화 음질 적응을 위해 Sync(모바일 채널) 65% + 서버 마이크(통신망 필터 적용본) 35% 가중 결합
    let (w_srv, w_sync) = (0.35f64, 0.65f64);
    let merged_a_raw: Vec<f64> = server_prof
        .embedding_a
        .iter()
        .zip(sync_prof.embedding_a.iter())
        .map(|(x, y)| x * w_srv + y * w_sync)
        .collect();
    let merged_b_raw: Vec<f64> = server_prof
        .embedding_b
        .iter()
        .zip(sync_prof.embedding_b.iter())
        .map(|(x, y)| x * w_srv + y * w_sync)
        .collect();

    let (emb_a, norm_a) = l2_normalize_vec(&merged_a_raw);
    let (emb_b, norm_b) = l2_normalize_vec(&merged_b_raw);
    let total_samples = server_prof.sample_count + sync_prof.sample_count;
    let upd_at = if server_prof.updated_at >= sync_prof.updated_at {
        server_prof.updated_at.clone()
    } else {
        sync_prof.updated_at.clone()
    };

    let raw_obj = serde_json::json!({
        "profileId": "user_master_combined",
        "displayName": "통합 마스터 음성지문 (서버 35% + Sync 65%)",
        "sourceMode": "hybrid",
        "sampleCount": total_samples,
        "serverVsSyncSimA": (sim_a * 10000.0).round() / 10000.0,
        "serverVsSyncSimB": (sim_b * 10000.0).round() / 10000.0,
        "crossAgreementScore": cross_score,
        "updatedAt": upd_at,
        "modelA": { "name": MODEL_A_LABEL, "dim": emb_a.len(), "l2Norm": norm_a, "embedding": emb_a },
        "modelB": { "name": MODEL_B_LABEL, "dim": emb_b.len(), "l2Norm": norm_b, "embedding": emb_b }
    });

    let combined = VoiceprintProfileItem {
        profile_id: "user_master_combined".to_string(),
        target_type: "user".to_string(),
        display_name: "통합 마스터 음성지문 (서버 + Sync)".to_string(),
        source_mode: "hybrid".to_string(),
        model_a_name: MODEL_A_LABEL.to_string(),
        model_b_name: MODEL_B_LABEL.to_string(),
        dim_a: emb_a.len(),
        dim_b: emb_b.len(),
        norm_a,
        norm_b,
        embedding_a: emb_a,
        embedding_b: emb_b,
        sample_count: total_samples,
        consistency_a: (sim_a * 1000.0).round() / 10.0,
        consistency_b: (sim_b * 1000.0).round() / 10.0,
        cross_agreement_score: cross_score,
        samples_meta: Vec::new(),
        raw_json_text: serde_json::to_string_pretty(&raw_obj).unwrap_or_default(),
        updated_at: upd_at,
    };

    (combined, (sim_a * 1000.0).round() / 10.0, (sim_b * 1000.0).round() / 10.0, cross_score)
}

pub(crate) fn enroll_audio_into_voiceprint_profile(
    conn: &Connection,
    profile_id: &str,
    display_name: &str,
    source_mode: &str,
    audio_path: &Path,
    phrase_text: &str,
    source_label: &str,
    simulate_telephony: bool,
) -> Result<VoiceprintProfileItem, String> {
    let extracted = run_dual_model_extractor(audio_path, "extract", simulate_telephony)?;
    let (new_a, _) = l2_normalize_vec(&extracted.embedding_a);
    let (new_b, _) = l2_normalize_vec(&extracted.embedding_b);

    let prev = load_voiceprint_profile(conn, profile_id, display_name, source_mode);
    let now_str = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    let calibrate_voice_maturity = |raw_cos: f64, sample_cnt: usize| -> f64 {
        let quality = ((raw_cos - 0.35) / (0.82 - 0.35)).clamp(0.0, 1.0) * 100.0;
        let coverage = (sample_cnt as f64 / 5.0).clamp(0.2, 1.0);
        ((quality * (0.4 + 0.6 * coverage)) * 10.0).round() / 10.0
    };

    let (merged_a, merged_b, sim_a, sim_b, next_count, next_con_a, next_con_b) =
        if prev.sample_count == 0 || prev.embedding_a.len() != new_a.len() || prev.embedding_b.len() != new_b.len() {
            (
                new_a.clone(),
                new_b.clone(),
                1.0,
                1.0,
                1usize,
                calibrate_voice_maturity(0.85, 1),
                calibrate_voice_maturity(0.85, 1),
            )
        } else {
            let sa = cosine_similarity_vec(&prev.embedding_a, &new_a);
            let sb = cosine_similarity_vec(&prev.embedding_b, &new_b);
            let w_prev = prev.sample_count as f64;
            let raw_a: Vec<f64> = prev
                .embedding_a
                .iter()
                .zip(new_a.iter())
                .map(|(p, n)| (p * w_prev + n) / (w_prev + 1.0))
                .collect();
            let raw_b: Vec<f64> = prev
                .embedding_b
                .iter()
                .zip(new_b.iter())
                .map(|(p, n)| (p * w_prev + n) / (w_prev + 1.0))
                .collect();
            let (normed_a, _) = l2_normalize_vec(&raw_a);
            let (normed_b, _) = l2_normalize_vec(&raw_b);
            let cnt = prev.sample_count + 1;

            let centroid_stab_a = cosine_similarity_vec(&prev.embedding_a, &normed_a);
            let centroid_stab_b = cosine_similarity_vec(&prev.embedding_b, &normed_b);
            let eff_cos_a = sa * 0.65 + centroid_stab_a * 0.35;
            let eff_cos_b = sb * 0.65 + centroid_stab_b * 0.35;

            let ca = calibrate_voice_maturity(eff_cos_a, cnt).clamp(0.0, 100.0);
            let cb = calibrate_voice_maturity(eff_cos_b, cnt).clamp(0.0, 100.0);
            (normed_a, normed_b, sa, sb, cnt, ca, cb)
        };

    let cross_agree = (((next_con_a + next_con_b) * 0.5) * 10.0).round() / 10.0;
    let mut metas = prev.samples_meta;
    metas.push(VoiceprintSampleMeta {
        phrase_text: phrase_text.to_string(),
        source_label: source_label.to_string(),
        duration_sec: extracted.duration_sec,
        sim_a: (sim_a * 1000.0).round() / 10.0,
        sim_b: (sim_b * 1000.0).round() / 10.0,
        created_at: now_str.clone(),
    });
    if metas.len() > 30 {
        let drop_n = metas.len() - 30;
        metas.drain(0..drop_n);
    }

    let emb_a_json = serde_json::to_string(&merged_a).unwrap_or_else(|_| "[]".to_string());
    let emb_b_json = serde_json::to_string(&merged_b).unwrap_or_else(|_| "[]".to_string());
    let meta_json = serde_json::to_string(&metas).unwrap_or_else(|_| "[]".to_string());

    conn.execute(
        "INSERT INTO voiceprint_profiles
         (profile_id, target_type, display_name, source_mode, model_a_name, model_b_name,
          embedding_a_json, embedding_b_json, sample_count, consistency_a, consistency_b,
          cross_agreement_score, samples_meta_json, updated_at)
         VALUES (?1, 'user', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
         ON CONFLICT(profile_id) DO UPDATE SET
            display_name = excluded.display_name,
            source_mode = excluded.source_mode,
            embedding_a_json = excluded.embedding_a_json,
            embedding_b_json = excluded.embedding_b_json,
            sample_count = excluded.sample_count,
            consistency_a = excluded.consistency_a,
            consistency_b = excluded.consistency_b,
            cross_agreement_score = excluded.cross_agreement_score,
            samples_meta_json = excluded.samples_meta_json,
            updated_at = excluded.updated_at",
        params![
            profile_id,
            display_name,
            source_mode,
            MODEL_A_LABEL,
            MODEL_B_LABEL,
            emb_a_json,
            emb_b_json,
            next_count as i64,
            next_con_a,
            next_con_b,
            cross_agree,
            meta_json,
            now_str,
        ],
    )
    .map_err(|e| format!("음성지문 DB 저장 실패: {}", e))?;

    if let Ok(appdata) = std::env::var("APPDATA") {
        let backup_path = Path::new(&appdata)
            .join("com.iseohyun.mylore")
            .join(format!("voiceprint_{}.json", profile_id));
        let loaded = load_voiceprint_profile(conn, profile_id, display_name, source_mode);
        let _ = fs::write(backup_path, loaded.raw_json_text.as_bytes());
        return Ok(loaded);
    }

    Ok(load_voiceprint_profile(conn, profile_id, display_name, source_mode))
}

fn collect_sync_audio_candidates(conn: &Connection) -> Vec<SyncAudioCandidateItem> {
    let contacts_map = load_mobile_contacts_map(conn);
    let calls_dir = get_archive_mobile_dir(conn, "calls");
    let calls_audio = calls_dir.join("audio");
    let rec_dir = get_archive_mobile_dir(conn, "recordings");
    let rec_audio = rec_dir.join("audio");

    let mut items: Vec<SyncAudioCandidateItem> = Vec::new();
    for (audio_dir, md_dir, category, is_rec) in [
        (&rec_audio, &rec_dir, "mobile/recordings", true),
        (&calls_audio, &calls_dir, "mobile/calls", false),
    ] {
        let Ok(entries) = fs::read_dir(audio_dir) else { continue };
        for entry in entries.flatten() {
            let p = entry.path();
            if !p.is_file() {
                continue;
            }
            let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
            if !["m4a", "amr", "mp3", "wav", "ogg", "aac"].contains(&ext.as_str()) {
                continue;
            }
            let file_name = p.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
            let file_stem = p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
            if file_stem.is_empty() {
                continue;
            }
            let safe_stem = sanitize_filename_stem(&file_stem);
            let md_path = md_dir.join(format!("{}.md", safe_stem));
            let mut status_str = "pending".to_string();
            if md_path.exists() {
                if let Ok(raw) = fs::read_to_string(&md_path) {
                    let (fm, _) = parse_frontmatter_and_body_simple(&raw);
                    if let Some(st) = fm.get("transcript_status") {
                        status_str = st.clone();
                    }
                }
            }
            let (contact_or_source, rec_date, rec_time) = if is_rec {
                let (_, src, d, t) = parse_voice_recording_filename_meta(&file_stem, "SM-S901N");
                (src, d, t)
            } else {
                parse_call_audio_filename_meta(&file_stem, &contacts_map)
            };
            let file_bytes = entry.metadata().map(|m| m.len()).unwrap_or(0);
            items.push(SyncAudioCandidateItem {
                file_name,
                full_path: p.to_string_lossy().to_string(),
                category: category.to_string(),
                contact_or_source,
                rec_date,
                rec_time,
                file_bytes,
                transcript_status: status_str,
            });
        }
    }

    items.sort_by(|a, b| {
        let prio = |x: &SyncAudioCandidateItem| {
            if x.category == "mobile/recordings" {
                2
            } else if x.transcript_status == "verified" {
                1
            } else {
                0
            }
        };
        prio(b)
            .cmp(&prio(a))
            .then_with(|| b.rec_date.cmp(&a.rec_date))
            .then_with(|| b.rec_time.cmp(&a.rec_time))
    });
    items.truncate(80);
    items
}

pub(crate) fn build_voiceprint_dashboard_payload(conn: &Connection) -> VoiceprintDashboardPayload {
    let models_dir = resolve_voiceprint_models_dir();
    let model_a_path = models_dir.join(MODEL_A_FILENAME);
    let model_b_path = models_dir.join(MODEL_B_FILENAME);
    let model_a_ready = model_a_path.is_file();
    let model_b_ready = model_b_path.is_file();
    let py_path = resolve_python_executable().unwrap_or_default();
    let ffmpeg_bin = resolve_ffmpeg_executable();
    let ffmpeg_ready = Path::new(&ffmpeg_bin).is_file() || ffmpeg_bin == "ffmpeg";

    let server_profile = load_voiceprint_profile(conn, "user_server_mic", "내 목소리 지문 (서버 마이크 생성)", "server_mic");
    let sync_profile = load_voiceprint_profile(conn, "user_sync_mobile", "내 목소리 지문 (Sync 모바일 연동 생성)", "sync_mobile");
    let (combined_profile, sim_a, sim_b, cross_score) = build_combined_master_profile(&server_profile, &sync_profile);

    let ips = detect_local_ipv4_addresses();
    let primary_ip = ips.first().cloned().unwrap_or_else(|| "127.0.0.1".to_string());
    let token: String = conn
        .query_row("SELECT value FROM mobile_sync_meta WHERE key = 'pairing_token'", [], |r| r.get(0))
        .unwrap_or_default();
    let sync_enroll_url = format!("http://{}:18443/api/v1/voiceprint/enroll?token={}", primary_ip, token);

    let sync_audio_candidates = collect_sync_audio_candidates(conn);

    VoiceprintDashboardPayload {
        engine_ready: model_a_ready && model_b_ready && !py_path.is_empty(),
        python_path: py_path,
        ffmpeg_ready,
        model_a_path: model_a_path.to_string_lossy().to_string(),
        model_b_path: model_b_path.to_string_lossy().to_string(),
        model_a_ready,
        model_b_ready, sync_enroll_url, server_profile, sync_profile, combined_profile,
        server_vs_sync_sim_a: sim_a, server_vs_sync_sim_b: sim_b,
        server_vs_sync_cross_score: cross_score, sync_audio_candidates,
    }
}

#[tauri::command]
pub(crate) fn get_voiceprint_dashboard_status(state: State<'_, AppState>) -> Result<VoiceprintDashboardPayload, String> {
    let conn = open_db(&state.db_path)?;
    Ok(build_voiceprint_dashboard_payload(&conn))
}

#[tauri::command]
pub(crate) async fn enroll_voiceprint_from_base64_audio(
    state: State<'_, AppState>,
    source_mode: String,
    phrase_text: String,
    audio_base64: String,
    file_ext: Option<String>,
) -> Result<VoiceprintDashboardPayload, String> {
    let db_path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_db(&db_path)?;
        let clean_b64 = audio_base64.split(',').last().unwrap_or(&audio_base64).trim();
        let bytes = base64_decode(clean_b64);
        if bytes.len() < 500 {
            return Err("녹음된 오디오 데이터가 너무 작습니다. 마이크 입력을 확인해 주세요.".to_string());
        }
        let ext = file_ext.unwrap_or_else(|| "webm".to_string());
        let tmp_dir = std::env::temp_dir().join("mylore_voiceprint");
        let _ = fs::create_dir_all(&tmp_dir);
        let tmp_file = tmp_dir.join(format!("enroll_{}.{}", Uuid::new_v4(), ext));
        fs::write(&tmp_file, &bytes).map_err(|e| format!("임시 오디오 저장 오류: {}", e))?;

        let (prof_id, disp_name, mode_key, src_label, sim_tel) = if source_mode == "sync_mobile" {
            ("user_sync_mobile", "내 목소리 지문 (Sync 모바일 연동 생성)", "sync_mobile", "Sync 모바일 마이크 녹음", false)
        } else {
            ("user_server_mic", "내 목소리 지문 (서버 마이크 생성)", "server_mic", "PC 서버 마이크 녹음 (통화대역 보정)", true)
        };
        let res = enroll_audio_into_voiceprint_profile(&conn, prof_id, disp_name, mode_key, &tmp_file, &phrase_text, src_label, sim_tel);
        let _ = fs::remove_file(&tmp_file);
        res?;
        Ok(build_voiceprint_dashboard_payload(&conn))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn enroll_voiceprint_from_synced_file(
    state: State<'_, AppState>,
    full_path: String,
    target_profile: Option<String>,
) -> Result<VoiceprintDashboardPayload, String> {
    let db_path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_db(&db_path)?;
        let path = PathBuf::from(&full_path);
        if !path.is_file() {
            return Err(format!("오디오 파일을 찾을 수 없습니다: {}", full_path));
        }
        let fname = path.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "synced_audio".to_string());
        let is_srv = target_profile.as_deref() == Some("user_server_mic");
        let (prof_id, disp_name, mode_key) = if is_srv {
            ("user_server_mic", "내 목소리 지문 (서버 마이크 생성)", "server_mic")
        } else {
            ("user_sync_mobile", "내 목소리 지문 (Sync 모바일 연동 생성)", "sync_mobile")
        };
        enroll_audio_into_voiceprint_profile(&conn, prof_id, disp_name, mode_key, &path, &format!("Sync 녹음 파일 추출: {}", fname), &fname, false)?;
        Ok(build_voiceprint_dashboard_payload(&conn))
    })
    .await
    .map_err(|e| e.to_string())?
}

const SERVER_VOICEPRINT_PHRASES: &[(&str, &str)] = &[
    ("1단계 · 통화 시작 인사 톤", "여보세요? 네, 안녕하세요. 정서현입니다. 말씀하세요."),
    ("2단계 · 짧은 추임새 · 긍정 응답 톤", "네, 네. 아, 그렇군요. 예, 알겠습니다. 그렇게 진행해 주시면 됩니다."),
    ("3단계 · 질문 및 일정 조율 톤", "혹시 지금 통화 괜찮으신가요? 내일 오후 두 시 반에 약속 장소에서 뵙겠습니다."),
    ("4단계 · 확인 및 마무리 인사 톤", "확인해 보고 조금 이따가 다시 연락드리겠습니다. 오늘 통화 감사합니다. 들어가세요."),
    ("5단계 · 자유 발화 / 추가 보강 문구", "이사 날짜와 시간은 확인되었고, 서류 관련 내용은 문자로 한 번 더 남겨주시면 좋겠습니다."),
];

/// 모바일 Sync 앱에서 마이크로 직접 음성지문을 생성/전송하는 HTTP 핸들러 (`/api/v1/voiceprint/enroll`)
pub(crate) fn handle_mobile_voiceprint_web(
    mut request: tiny_http::Request,
    app_handle: AppHandle,
    db_path: PathBuf,
) {
    if request.method() == &tiny_http::Method::Get {
        let Ok(conn) = open_db(&db_path) else {
            respond_json(request, 500, serde_json::json!({ "ok": false, "error": "DB 열기 실패" }));
            return;
        };
        let sync_prof = load_voiceprint_profile(&conn, "user_sync_mobile", "내 목소리 지문 (Sync 모바일 연동 생성)", "sync_mobile");
        let idx = (sync_prof.sample_count.max(0) as usize) % SERVER_VOICEPRINT_PHRASES.len();
        let (title, phrase_text) = SERVER_VOICEPRINT_PHRASES[idx];

        let _ = app_handle.emit("mobile-sync-event", serde_json::json!({
            "type": "voiceprint_session_started", "phraseIdx": idx, "phraseTitle": title, "phraseText": phrase_text,
        }));
        respond_json(request, 200, serde_json::json!({
            "ok": true, "phraseIdx": idx, "totalPhrases": SERVER_VOICEPRINT_PHRASES.len(),
            "phraseTitle": title, "phraseText": phrase_text, "sampleCount": sync_prof.sample_count,
            "crossAgreementScore": sync_prof.cross_agreement_score,
            "consistencyA": sync_prof.consistency_a, "consistencyB": sync_prof.consistency_b,
        }));
        return;
    }

    if request.method() == &tiny_http::Method::Post {
        let mut body_str = String::new();
        let _ = request.as_reader().read_to_string(&mut body_str);
        let parsed: serde_json::Value = serde_json::from_str(&body_str).unwrap_or_default();
        let b64 = parsed.get("audioBase64").and_then(|v| v.as_str()).unwrap_or("");
        let ext = parsed.get("fileExt").and_then(|v| v.as_str()).unwrap_or("m4a");

        let Ok(conn) = open_db(&db_path) else {
            respond_json(request, 500, serde_json::json!({ "ok": false, "error": "DB 열기 실패" }));
            return;
        };
        let prev_prof = load_voiceprint_profile(&conn, "user_sync_mobile", "내 목소리 지문 (Sync 모바일 연동 생성)", "sync_mobile");
        let cur_idx = (prev_prof.sample_count.max(0) as usize) % SERVER_VOICEPRINT_PHRASES.len();
        let default_phrase = SERVER_VOICEPRINT_PHRASES[cur_idx].1;
        let phrase = parsed.get("phraseText").and_then(|v| v.as_str()).filter(|s| !s.trim().is_empty()).unwrap_or(default_phrase);

        let clean = b64.split(',').last().unwrap_or(b64).trim();
        let bytes = base64_decode(clean);
        if bytes.len() < 300 {
            respond_json(request, 400, serde_json::json!({ "ok": false, "error": "Base64 오디오 데이터가 너무 짧거나 손상되었습니다." }));
            return;
        }
        let tmp_dir = std::env::temp_dir().join("mylore_voiceprint");
        let _ = fs::create_dir_all(&tmp_dir);
        let tmp_file = tmp_dir.join(format!("mobile_sync_{}.{}", Uuid::new_v4(), ext));
        if fs::write(&tmp_file, &bytes).is_err() {
            respond_json(request, 500, serde_json::json!({ "ok": false, "error": "임시 파일 저장 실패" }));
            return;
        }
        let res = enroll_audio_into_voiceprint_profile(
            &conn, "user_sync_mobile", "내 목소리 지문 (Sync 모바일 연동 생성)", "sync_mobile",
            &tmp_file, phrase, "Sync 모바일 앱 채취", false,
        );
        let _ = fs::remove_file(&tmp_file);
        match res {
            Ok(prof) => {
                let next_idx = (prof.sample_count.max(0) as usize) % SERVER_VOICEPRINT_PHRASES.len();
                let (next_title, next_phrase) = SERVER_VOICEPRINT_PHRASES[next_idx];
                let _ = app_handle.emit("mobile-sync-event", serde_json::json!({
                    "type": "voiceprint_enrolled", "sampleCount": prof.sample_count,
                    "crossAgreementScore": prof.cross_agreement_score,
                    "consistencyA": prof.consistency_a, "consistencyB": prof.consistency_b,
                    "nextPhraseIdx": next_idx, "nextPhraseTitle": next_title, "nextPhraseText": next_phrase,
                }));
                respond_json(request, 200, serde_json::json!({
                    "ok": true, "sampleCount": prof.sample_count,
                    "crossAgreementScore": prof.cross_agreement_score,
                    "consistencyA": prof.consistency_a, "consistencyB": prof.consistency_b,
                    "nextPhraseIdx": next_idx, "totalPhrases": SERVER_VOICEPRINT_PHRASES.len(),
                    "nextPhraseTitle": next_title, "nextPhraseText": next_phrase,
                }));
            }
            Err(e) => respond_json(request, 400, serde_json::json!({ "ok": false, "error": e })),
        }
        return;
    }

    respond_json(request, 405, serde_json::json!({ "ok": false, "error": "지원하지 않는 HTTP 메서드입니다." }));
}
