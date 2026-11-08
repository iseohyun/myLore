/**
 * @file VoiceprintSection.tsx
 * @description 설정(`Ctrl+,`) > `AI > 🎙️ 음성지문 작성 (Voiceprint)` 대시보드:
 * 1) **1번째 카드**: [서버에서 녹음] 탭과 [Sync앱에서 녹음] 2개 탭으로 이원화하여 설명·가이드 문구(꼭 따라 읽지 않고 자유 발화 가능 안내 포함) 및 녹음 컨트롤 제공
 * 2) **2번째 카드**: 작성된 음성지문 Text(JSON) 뷰어 및 편집기
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  VoiceprintDashboardPayload,
  VoiceprintProfileItem,
} from '../../types/mylore';

const isTauriEnv = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

async function fetchVoiceprintDashboard(): Promise<VoiceprintDashboardPayload> {
  if (isTauriEnv()) {
    return await invoke<VoiceprintDashboardPayload>('get_voiceprint_dashboard_status');
  }
  const emptyProf = (id: string, name: string, mode: string): VoiceprintProfileItem => ({
    profileId: id,
    targetType: 'user',
    displayName: name,
    sourceMode: mode,
    modelAName: '3D-Speaker CAM++ (192D)',
    modelBName: 'WeSpeaker ResNet34-LM (256D)',
    dimA: 192,
    dimB: 256,
    normA: 0,
    normB: 0,
    embeddingA: [],
    embeddingB: [],
    sampleCount: 0,
    consistencyA: 0,
    consistencyB: 0,
    crossAgreementScore: 0,
    samplesMeta: [],
    rawJsonText: '{}',
    updatedAt: '',
  });
  return {
    engineReady: false,
    pythonPath: '',
    ffmpegReady: false,
    modelAPath: '',
    modelBPath: '',
    modelAReady: false,
    modelBReady: false,
    syncEnrollUrl: '',
    serverProfile: emptyProf('user_server_mic', '서버 마이크 음성지문', 'server_mic'),
    syncProfile: emptyProf('user_sync_mobile', 'Sync 연동 음성지문', 'sync_mobile'),
    combinedProfile: emptyProf('user_master_combined', '통합 마스터 음성지문', 'hybrid'),
    serverVsSyncSimA: 0,
    serverVsSyncSimB: 0,
    serverVsSyncCrossScore: 0,
    syncAudioCandidates: [],
  };
}

const ENROLL_PHRASES: Array<{ title: string; text: string; tip: string }> = [
  {
    title: '1단계 · 통화 시작 인사 톤',
    text: '여보세요? 네, 안녕하세요. 정서현입니다. 말씀하세요.',
    tip: '전화 받을 때의 가장 흔한 첫마디입니다. 평소 전화 받듯 자연스럽게 말씀해 주세요.',
  },
  {
    title: '2단계 · 짧은 추임새 · 긍정 응답 톤',
    text: '네, 네. 아, 그렇군요. 예, 알겠습니다. 그렇게 진행해 주시면 됩니다.',
    tip: '통화 중 가장 자주 뒤바뀌는 단답형 구간("네", "예")의 성대 공명을 학습합니다.',
  },
  {
    title: '3단계 · 질문 및 일정 조율 톤',
    text: '혹시 지금 통화 괜찮으신가요? 내일 오후 두 시 반에 약속 장소에서 뵙겠습니다.',
    tip: '억양이 올라가는 의문문과 숫자 발음 시의 주파수 특성을 추출합니다.',
  },
  {
    title: '4단계 · 확인 및 마무리 인사 톤',
    text: '확인해 보고 조금 이따가 다시 연락드리겠습니다. 오늘 통화 감사합니다. 들어가세요.',
    tip: '통화 종료 직전 낮아지는 음성 톤까지 포함하여 지문 수렴도를 완성합니다.',
  },
  {
    title: '5단계 · 자유 발화 / 추가 보강 문구',
    text: '이사 날짜와 시간은 확인되었고, 서류 관련 내용은 문자로 한 번 더 남겨주시면 좋겠습니다.',
    tip: '5회 이상 다양한 톤으로 누적하면 Model A(CAM++)와 Model B(ResNet34)의 지문 완성도가 100%로 수렴합니다.',
  },
];

export interface VoiceprintSectionProps {
  setStatusMessage: React.Dispatch<React.SetStateAction<string>>;
}

export function VoiceprintSection({ setStatusMessage }: VoiceprintSectionProps) {
  const [dashboard, setDashboard] = useState<VoiceprintDashboardPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeBuildMode, setActiveBuildMode] = useState<'server_mic' | 'sync_mobile'>('server_mic');
  const [phraseIdx, setPhraseIdx] = useState(0);
  const [isRecordingEnroll, setIsRecordingEnroll] = useState(false);
  const [isProcessingEnroll, setIsProcessingEnroll] = useState(false);

  // 텍스트(JSON) 뷰어 상태
  const [activeTextTab, setActiveTextTab] = useState<'server' | 'sync' | 'combined'>('server');
  const [editableJsonText, setEditableJsonText] = useState('');

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchVoiceprintDashboard();
      setDashboard(data);
    } catch (e) {
      setStatusMessage(`❌ 음성지문 상태 조회 실패: ${String(e)}`);
    } finally {
      setLoading(false);
    }
  }, [setStatusMessage]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (!isTauriEnv()) return;
    let unlistenFn: (() => void) | null = null;
    void listen<Record<string, unknown>>('mobile-sync-event', (event) => {
      const p = event.payload;
      if (!p || typeof p !== 'object') return;
      if (p.type === 'voiceprint_session_started') {
        setActiveBuildMode('sync_mobile');
        if (typeof p.phraseIdx === 'number') {
          setPhraseIdx(p.phraseIdx % ENROLL_PHRASES.length);
        }
        setStatusMessage(
          '📱 myLoreSync 모바일 음성 채취가 시작되었습니다! 모니터에 제시된 문구(또는 자유 발화)를 녹음한 뒤 휴대폰에서 [음성녹음 종료]를 눌러주세요.'
        );
      } else if (p.type === 'voiceprint_enrolled') {
        void loadStatus();
        if (typeof p.nextPhraseIdx === 'number') {
          setPhraseIdx(p.nextPhraseIdx % ENROLL_PHRASES.length);
        } else {
          setPhraseIdx((prev) => (prev + 1) % ENROLL_PHRASES.length);
        }
        setActiveTextTab('sync');
        setStatusMessage(
          `✅ Sync앱 음성 채취 수신 완료! (누적 ${String(p.sampleCount ?? '')}회 · 지문 완성도 ${String(p.crossAgreementScore ?? '')}%) — 다음 단계 문구로 전환되었습니다.`
        );
      }
    }).then((fn) => {
      unlistenFn = fn;
    });
    return () => {
      if (unlistenFn) unlistenFn();
    };
  }, [loadStatus, setStatusMessage]);

  useEffect(() => {
    if (!dashboard) return;
    if (activeTextTab === 'server') {
      setEditableJsonText(dashboard.serverProfile.rawJsonText);
    } else if (activeTextTab === 'sync') {
      setEditableJsonText(dashboard.syncProfile.rawJsonText);
    } else {
      setEditableJsonText(dashboard.combinedProfile.rawJsonText);
    }
  }, [dashboard, activeTextTab]);

  const currentPhraseObj = ENROLL_PHRASES[phraseIdx % ENROLL_PHRASES.length];

  // 서버 마이크로 녹음하여 지문 생성
  const handleToggleServerEnrollRecord = async () => {
    if (isRecordingEnroll) {
      mediaRecorderRef.current?.stop();
      setIsRecordingEnroll(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) audioChunksRef.current.push(ev.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        setIsProcessingEnroll(true);
        setStatusMessage('⏳ 2종 오픈소스 성문 모델(CAM++ 192D & ResNet34 256D)로 음성지문 추출 및 교차검증 중...');
        const reader = new FileReader();
        reader.onloadend = async () => {
          try {
            const b64 = String(reader.result || '');
            const updated = await invoke<VoiceprintDashboardPayload>(
              'enroll_voiceprint_from_base64_audio',
              {
                sourceMode: 'server_mic',
                phraseText: currentPhraseObj.text,
                audioBase64: b64,
                fileExt: 'webm',
              }
            );
            setDashboard(updated);
            setPhraseIdx((prev) => (prev + 1) % ENROLL_PHRASES.length);
            setActiveTextTab('server');
            const prof = updated.serverProfile;
            setStatusMessage(
              `✅ [${prof.displayName}] 누적 완료! (샘플 ${prof.sampleCount}회 · 지문 완성도 ${prof.crossAgreementScore}%)`
            );
          } catch (err) {
            setStatusMessage(`❌ 음성지문 생성 실패: ${String(err)}`);
          } finally {
            setIsProcessingEnroll(false);
          }
        };
        reader.readAsDataURL(blob);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecordingEnroll(true);
      setStatusMessage('🔴 서버 마이크 녹음 중... 아래 문구를 읽거나 자유롭게 말씀하신 뒤 [⏹️ 녹음 완료 및 지문 반영]을 눌러주세요.');
    } catch (err) {
      setStatusMessage(`❌ PC 마이크 접근 권한 오류: ${String(err)}`);
    }
  };

  // 텍스트 JSON 저장 및 초기화
  const handleSaveRawJson = async () => {
    const targetId =
      activeTextTab === 'sync' ? 'user_sync_mobile' : 'user_server_mic';
    try {
      const updated = await invoke<VoiceprintDashboardPayload>('save_voiceprint_raw_json', {
        profileId: targetId,
        rawJsonText: editableJsonText,
      });
      setDashboard(updated);
      setStatusMessage(`✅ [${targetId}] 음성지문 JSON 텍스트가 저장되었습니다.`);
    } catch (err) {
      setStatusMessage(`❌ JSON 저장 오류: ${String(err)}`);
    }
  };

  const handleResetProfile = async (profileId: string) => {
    try {
      const updated = await invoke<VoiceprintDashboardPayload>('reset_voiceprint_profile', {
        profileId,
      });
      setDashboard(updated);
      setStatusMessage(`🗑️ [${profileId}] 음성지문이 초기화되었습니다.`);
    } catch (err) {
      setStatusMessage(`❌ 초기화 실패: ${String(err)}`);
    }
  };

  const srvProf = dashboard?.serverProfile;
  const syncProf = dashboard?.syncProfile;
  const combProf = dashboard?.combinedProfile;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* 1번째 카드: [서버에서 녹음] vs [Sync앱에서 녹음] 2개 탭 이원화 + 설명 + 읽을 문구 제시 */}
      <div
        style={{
          padding: '18px',
          backgroundColor: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: '10px',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '10px',
          }}
        >
          <div>
            <h3 style={{ fontSize: '16px', fontWeight: 700, margin: 0 }}>
              🎙️ 듀얼 오픈소스 교차검증 음성지문(Voiceprint) 작성
            </h3>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '4px 0 0 0', lineHeight: 1.5 }}>
              서로 다른 두 신경망(<b>Model A: 3D-Speaker CAM++ 192차원</b> + <b>Model B: WeSpeaker ResNet34-LM 256차원</b>)으로 내 목소리 성대 공명 지문을 추출하여 통화 스크립트의 화자 뒤바뀜을 방지합니다.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="toolbar-btn" onClick={() => void loadStatus()} disabled={loading}>
              🔄 상태 새로고침
            </button>
            <button
              className="toolbar-btn"
              style={{ color: '#f87171', borderColor: 'rgba(248,113,113,0.4)' }}
              onClick={() => void handleResetProfile('all')}
            >
              🗑️ 전체 지문 초기화
            </button>
          </div>
        </div>

        {/* 2개 탭: [서버에서 녹음] / [Sync앱에서 녹음] */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            className={`toolbar-btn ${activeBuildMode === 'server_mic' ? 'primary' : ''}`}
            style={{ padding: '9px 18px', fontSize: '13.5px', fontWeight: 700 }}
            onClick={() => {
              setActiveBuildMode('server_mic');
              setActiveTextTab('server');
            }}
          >
            🖥️ 서버에서 녹음
          </button>
          <button
            className={`toolbar-btn ${activeBuildMode === 'sync_mobile' ? 'primary' : ''}`}
            style={{ padding: '9px 18px', fontSize: '13.5px', fontWeight: 700 }}
            onClick={() => {
              setActiveBuildMode('sync_mobile');
              setActiveTextTab('sync');
            }}
          >
            📱 Sync앱에서 녹음
          </button>
        </div>

        {/* 엔진 및 2대 프로필 수렴도 요약 */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: '12px',
          }}
        >
          {[
            {
              prof: srvProf,
              badge: '🖥️ 서버에서 녹음한 지문 (user_server_mic)',
              accent: '#4ade80',
              isSelected: activeBuildMode === 'server_mic',
            },
            {
              prof: syncProf,
              badge: '📱 Sync앱에서 녹음한 지문 (user_sync_mobile)',
              accent: '#38bdf8',
              isSelected: activeBuildMode === 'sync_mobile',
            },
          ].map(({ prof, badge, accent, isSelected }) => (
            <div
              key={badge}
              style={{
                padding: '12px 14px',
                backgroundColor: 'var(--bg-primary)',
                border: `1.5px solid ${isSelected ? accent : 'var(--border-color)'}`,
                borderRadius: '8px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 700, fontSize: '13px', color: accent }}>{badge}</span>
                <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                  누적 샘플: <b>{prof?.sampleCount ?? 0}회</b>
                </span>
              </div>
              <div style={{ marginTop: '8px', fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div>
                  • 교차검증 지문 완성도:{' '}
                  <b style={{ color: '#fde047', fontSize: '14px' }}>
                    {prof?.crossAgreementScore ?? 0}%
                  </b>{' '}
                  (CAM++ {prof?.consistencyA ?? 0}% / ResNet34 {prof?.consistencyB ?? 0}%)
                </div>
                <div style={{ color: 'var(--text-secondary)', fontSize: '11.5px' }}>
                  • 벡터 차원: A={prof?.dimA ?? 192}D ({ dashboard?.modelAReady ? '준비됨' : '미설치' }) / B={prof?.dimB ?? 256}D ({ dashboard?.modelBReady ? '준비됨' : '미설치' })
                </div>
                <div style={{ color: 'var(--text-secondary)', fontSize: '11px' }}>
                  • 마지막 갱신: {prof?.updatedAt || '아직 생성되지 않음'}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* 공통 문구 제시 및 탭별 녹음 안내 영역 */}
        <div
          style={{
            padding: '16px',
            backgroundColor: 'var(--bg-primary)',
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
            <span
              style={{
                fontWeight: 700,
                fontSize: '13.5px',
                color: activeBuildMode === 'server_mic' ? '#4ade80' : '#38bdf8',
              }}
            >
              {activeBuildMode === 'server_mic' ? '🖥️ [서버에서 녹음]' : '📱 [Sync앱에서 녹음]'} — {currentPhraseObj.title} ({phraseIdx + 1} / {ENROLL_PHRASES.length})
            </span>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                className="toolbar-btn"
                onClick={() =>
                  setPhraseIdx((p) => (p - 1 + ENROLL_PHRASES.length) % ENROLL_PHRASES.length)
                }
              >
                ◀ 이전 문구
              </button>
              <button
                className="toolbar-btn"
                onClick={() => setPhraseIdx((p) => (p + 1) % ENROLL_PHRASES.length)}
              >
                다음 문구 ▶
              </button>
            </div>
          </div>

          {/* 읽을 문구 제시 박스 */}
          <div
            style={{
              padding: '14px 16px',
              backgroundColor: 'var(--bg-secondary)',
              border: `1px solid ${activeBuildMode === 'server_mic' ? 'var(--accent-primary)' : '#38bdf8'}`,
              borderRadius: '8px',
              fontSize: '16px',
              fontWeight: 700,
              color: '#fde047',
              lineHeight: 1.5,
            }}
          >
            “{currentPhraseObj.text}”
          </div>

          {/* 설명 및 꼭 따라 읽지 않아도 된다는 안내 메시지 */}
          <div
            style={{
              fontSize: '12.5px',
              color: 'var(--text-secondary)',
              lineHeight: 1.6,
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
            }}
          >
            <div>💡 {currentPhraseObj.tip}</div>
            <div style={{ color: '#fde047', fontWeight: 600 }}>
              ※ 두 성문 모델(`CAM++` · `ResNet34-LM`)은 글자(Text)가 아니라 성대 공명과 음색 주파수만 분석하므로, <b>위 제시된 문구를 꼭 그대로 따라 읽지 않으셔도 됩니다!</b> 평소 전화 통화할 때처럼 자연스럽게 아무 말씀이나 자유롭게 녹음하셔도 음성지문 완성에 동일하게(오히려 더 자연스럽게) 반영됩니다.
            </div>
          </div>

          {/* 탭 1: 서버에서 녹음 컨트롤 */}
          {activeBuildMode === 'server_mic' ? (
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginTop: '4px' }}>
              <button
                className={`toolbar-btn ${isRecordingEnroll ? '' : 'primary'}`}
                style={{
                  padding: '9px 18px',
                  fontWeight: 700,
                  fontSize: '13px',
                  backgroundColor: isRecordingEnroll ? '#ef4444' : undefined,
                  color: isRecordingEnroll ? '#fff' : undefined,
                }}
                disabled={isProcessingEnroll}
                onClick={() => void handleToggleServerEnrollRecord()}
              >
                {isRecordingEnroll
                  ? '⏹️ 녹음 완료 및 서버 지문 반영'
                  : isProcessingEnroll
                  ? '⏳ 2종 모델 분석 중...'
                  : '🎙️ PC 마이크로 녹음 시작'}
              </button>
              <button
                className="toolbar-btn"
                onClick={() => void handleResetProfile('user_server_mic')}
              >
                ↺ 서버 지문 초기화
              </button>
            </div>
          ) : (
            /* 탭 2: Sync앱에서 녹음 안내 및 컨트롤 */
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginTop: '4px' }}>
              <div style={{ fontSize: '12.5px', color: '#38bdf8', fontWeight: 600 }}>
                📲 스마트폰 <b>myLoreSync 앱 &gt; 설정 하단 &gt; [🎙️ 모바일 음성 채취하기]</b> 버튼을 누르고 통화 자세로 말씀하신 뒤 휴대폰에서 <b>[음성녹음 종료]</b>를 누르면 이 화면의 Sync 지문이 자동 갱신되고 다음 문구로 넘어갑니다.
              </div>
              <button
                className="toolbar-btn"
                onClick={() => void handleResetProfile('user_sync_mobile')}
              >
                ↺ Sync 지문 초기화
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 2번째 카드: 작성된 음성지문 Text(JSON) 뷰어 및 편집기 */}
      <div
        style={{
          padding: '16px 18px',
          backgroundColor: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: '10px',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '8px',
            marginBottom: '10px',
          }}
        >
          <div>
            <h3 style={{ fontSize: '15px', fontWeight: 700, margin: 0 }}>
              📄 작성된 음성지문 Text (JSON 임베딩 벡터) 확인 및 편집
            </h3>
            <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>
              Model A(192차원 Float 배열)와 Model B(256차원 Float 배열) 및 샘플 이력을 텍스트로 직접 확인·복사·수정할 수 있습니다.
            </span>
          </div>

          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            <button
              className={`toolbar-btn ${activeTextTab === 'server' ? 'primary' : ''}`}
              onClick={() => setActiveTextTab('server')}
            >
              🖥️ 서버 지문 Text ({srvProf?.sampleCount ?? 0})
            </button>
            <button
              className={`toolbar-btn ${activeTextTab === 'sync' ? 'primary' : ''}`}
              onClick={() => setActiveTextTab('sync')}
            >
              📱 Sync 지문 Text ({syncProf?.sampleCount ?? 0})
            </button>
            <button
              className={`toolbar-btn ${activeTextTab === 'combined' ? 'primary' : ''}`}
              onClick={() => setActiveTextTab('combined')}
            >
              🔗 통합 마스터 지문 Text ({combProf?.sampleCount ?? 0})
            </button>
            <button
              className="toolbar-btn"
              onClick={() => {
                void navigator.clipboard.writeText(editableJsonText);
                setStatusMessage('📋 음성지문 JSON 텍스트가 클립보드에 복사되었습니다.');
              }}
            >
              📋 JSON 복사
            </button>
            {activeTextTab !== 'combined' && (
              <button className="toolbar-btn primary" onClick={() => void handleSaveRawJson()}>
                💾 텍스트 수정사항 저장
              </button>
            )}
          </div>
        </div>

        <textarea
          className="input-field"
          style={{
            width: '100%',
            minHeight: '260px',
            fontFamily: 'Consolas, monospace',
            fontSize: '12px',
            lineHeight: 1.45,
            resize: 'vertical',
          }}
          value={editableJsonText}
          onChange={(e) => setEditableJsonText(e.target.value)}
          readOnly={activeTextTab === 'combined'}
        />
      </div>
    </div>
  );
}
