/**
 * @file useLifelogAndFinance.ts
 * @description 모바일 페어링/QR 생성, 연락처 이름 해석, Gemini API 키 검증/클립보드 감지, 일자별 라이프로그, 가계부 조회 및 엑셀(`xlsx` 지연 로딩) 업로드 훅.
 */
import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
  DocumentPayload,
  FinanceTransaction,
  GeminiApiKeyStatus,
  LifelogMessage,
  LifelogSourceType,
  MobileContextMenuState,
  MobilePairingPayload,
  MobileSyncProgressPayload,
  RightSidebarTab,
} from '../types/mylore';
import {
  getAllFinanceTransactions,
  getAllLifelogMessages,
  getGeminiApiKeyStatus,
  getLifelogForDate,
  getMobileContactsMap,
  getMobilePairingInfo,
  importFinanceRows,
  openLifelogItemDocument,
  saveAndVerifyGeminiApiKey,
} from '../services/tauriClient';
import { splitYamlFrontmatter } from '../utils/markdownAutoFormat';

export interface UseLifelogAndFinanceParams {
  currentDoc: DocumentPayload | null;
  activeTabPath: string | null;
  currentDocMobileSource: LifelogSourceType | null;
  isCurrentDocMobileLifelog: boolean;
  isCurrentDocSms: boolean;
  isMobileDataSidebarMode: boolean;
  rightSidebarOpen: boolean;
  setRightSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  rightTab: RightSidebarTab;
  editorRef: React.MutableRefObject<HTMLTextAreaElement | null>;
  previewPaneRef: React.MutableRefObject<HTMLDivElement | null>;
  refreshTree: () => Promise<void>;
  applyLoadedDocument: (
    doc: DocumentPayload,
    jumpTo?: {
      lineNumber?: number;
      charOffset?: number;
      highlightLength?: number;
    }
  ) => void;
  loadCallAudioIntoStatusBar: (
    roomOrSender: string,
    attachmentUuid?: string,
    autoPlay?: boolean,
    seekSec?: number
  ) => Promise<void>;
  setStatusMessage: React.Dispatch<React.SetStateAction<string>>;
}

export function useLifelogAndFinance({
  currentDoc,
  activeTabPath,
  currentDocMobileSource,
  isCurrentDocMobileLifelog,
  isCurrentDocSms,
  isMobileDataSidebarMode,
  rightSidebarOpen,
  setRightSidebarOpen,
  rightTab,
  editorRef,
  previewPaneRef,
  refreshTree,
  applyLoadedDocument,
  loadCallAudioIntoStatusBar,
  setStatusMessage,
}: UseLifelogAndFinanceParams) {
  // 라이프로그 & 3단계 금융 자동화 상태
  const [selectedDate, setSelectedDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [dailyMessages, setDailyMessages] = useState<LifelogMessage[]>([]);
  const [dailyTransactions, setDailyTransactions] = useState<
    FinanceTransaction[]
  >([]);
  const [allTransactions, setAllTransactions] = useState<FinanceTransaction[]>(
    []
  );
  const [reconcileResultMsg, setReconcileResultMsg] = useState('');

  // 모바일 연동(myLore Sync) QR 코드 페어링 및 상태 관리
  const [mobilePairing, setMobilePairing] =
    useState<MobilePairingPayload | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [ssidInputText, setSsidInputText] = useState('');
  const [geminiStatus, setGeminiStatus] =
    useState<GeminiApiKeyStatus | null>(null);
  const [geminiKeyInput, setGeminiKeyInput] = useState('');
  const [isVerifyingGemini, setIsVerifyingGemini] = useState(false);
  const [awaitingClipboardKey, setAwaitingClipboardKey] = useState(false);
  const [isTranscribingSingleCall, setIsTranscribingSingleCall] =
    useState(false);

  // 라이프로그 수집 대쉬보드 2개 탭 (설정 | 휴대폰데이터) 및 휴대폰 데이터 사이드바 상태
  const [lifelogDashboardTab, setLifelogDashboardTab] = useState<
    'settings' | 'mobile'
  >('settings');
  const [mobileSidebarTab, setMobileSidebarTab] = useState<LifelogSourceType>(
    'kakaotalk'
  );
  const [allLifelogMessages, setAllLifelogMessages] = useState<
    LifelogMessage[]
  >([]);
  const [mobilePersonFilter, setMobilePersonFilter] = useState<string>('');
  const [mobileSourceFilter, setMobileSourceFilter] = useState<
    'all' | LifelogSourceType
  >('all');
  const [mobileSyncProgress, setMobileSyncProgress] =
    useState<MobileSyncProgressPayload | null>(null);
  const [financeSubTab, setFinanceSubTab] = useState<'all' | 'card' | 'bank'>(
    'all'
  );
  const [mobileContextMenu, setMobileContextMenu] =
    useState<MobileContextMenuState | null>(null);
  const [contactsMap, setContactsMap] = useState<Record<string, string>>({});
  const [smsRawEditMode, setSmsRawEditMode] = useState<boolean>(false);
  const [isRetryingCalls, setIsRetryingCalls] = useState<boolean>(false);
  const [selectedLifelogMsgId, setSelectedLifelogMsgId] = useState<
    number | null
  >(null);

  const smsBubbleScrollRef = useRef<HTMLDivElement | null>(null);
  const excelInputRef = useRef<HTMLInputElement | null>(null);

  const normalizePhoneDigits = (raw: string): string => {
    const digits = (raw || '').replace(/\D/g, '');
    if (digits.startsWith('8210') && digits.length === 12) {
      return `0${digits.slice(2)}`;
    }
    if (digits.startsWith('82') && digits.length >= 11) {
      return `0${digits.slice(2)}`;
    }
    return digits;
  };

  // 전화번호를 기본으로 하되, 연락처 주소록에 이미 저장된 번호라면 저장된 이름을 반환하며
  // `이름_전화번호_날짜` 포맷일 경우 전화번호와 날짜를 제거하고 순수 `이름`만 추출합니다.
  const resolveContactName = (rawNumberOrName: string): string => {
    const s = (rawNumberOrName || '')
      .trim()
      .replace(/^(통화\s*녹음[_\s]*|Call_)/i, '')
      .replace(/\s*\([0-9+\-\s]{7,}\)\s*$/, '')
      .replace(/_(\d{8})_(\d{6})$/, '')
      .replace(/_(\d{6})_(\d{6})$/, '')
      .replace(/_(\d{8,14})$/, '')
      .trim();
    if (!s) return '알수없음';

    if (s.includes('_')) {
      const parts = s
        .split('_')
        .map((p) => p.trim())
        .filter(Boolean);
      if (parts.length > 0) {
        const first = parts[0];
        const firstDigits = normalizePhoneDigits(first);
        const isFirstPhone =
          firstDigits.length >= 7 && /^[0-9+\-]+$/.test(first);
        if (!isFirstPhone) {
          return contactsMap[first] || first;
        }
        if (contactsMap[first]) return contactsMap[first];
        if (contactsMap[firstDigits]) return contactsMap[firstDigits];
        return first;
      }
    }

    if (contactsMap[s]) return contactsMap[s];
    const digits = normalizePhoneDigits(s);
    if (digits.length >= 8 && contactsMap[digits]) {
      return contactsMap[digits];
    }
    return s;
  };

  // 현재 열람/편집 중인 모바일 문서에 해당하는 사이드바 항목인지 판별
  const isLifelogMessageMatchingCurrentDoc = (msg: LifelogMessage): boolean => {
    if (!currentDoc || !currentDocMobileSource) return false;
    if (msg.source !== currentDocMobileSource) return false;

    const docFileName = currentDoc.fullPath.split(/[\\/]/).pop() || '';
    const docStem = docFileName.replace(/\.md$/i, '').trim();
    const fmContact = (currentDoc.frontmatter['contact_name'] || '').trim();
    const fmPhone = (currentDoc.frontmatter['phone_number'] || '').trim();
    const fmAudio = (currentDoc.frontmatter['audio_file'] || '').trim();

    const stripCallDecorations = (s: string) =>
      (s || '')
        .replace(/^#+/, '')
        .replace(/\s*\([^)]*\)/g, '')
        .trim();

    if (msg.source === 'call' || msg.source === 'recording') {
      const rawAtt = (msg.attachmentUuid || '')
        .replace(/^transcribed:/, '')
        .replace(/^pending_transcript:/, '')
        .trim();
      if (fmAudio && rawAtt && rawAtt === fmAudio) return true;
      const attStem = rawAtt
        .replace(/\.(m4a|mp3|amr|wav|ogg|aac)$/i, '')
        .trim();
      if (attStem && (attStem === docStem || docStem.includes(attStem))) {
        return true;
      }

      if (msg.source === 'recording') {
        const msgRoom = (msg.roomOrSender || '').trim();
        return Boolean(
          docStem &&
            (msgRoom === docStem ||
              docStem.includes(msgRoom) ||
              msgRoom.includes(docStem))
        );
      }

      const rawTarget =
        msg.sender && msg.sender !== '통화녹음' && !msg.sender.includes('통화')
          ? msg.sender
          : msg.roomOrSender;
      const msgContact = stripCallDecorations(resolveContactName(rawTarget));
      const msgRawContact = stripCallDecorations(rawTarget);

      const stemContact = stripCallDecorations(
        docStem
          .replace(/^통화\s*녹음\s*/i, '')
          .replace(/_\d{6}_\d{6}$/, '')
          .replace(/_\d{14}$/, '')
      );
      const docContact = stripCallDecorations(fmContact || stemContact);
      const resolvedDocContact = stripCallDecorations(
        resolveContactName(docContact)
      );

      if (
        docContact &&
        (msgContact === docContact ||
          msgContact === resolvedDocContact ||
          msgRawContact === docContact ||
          (normalizePhoneDigits(rawTarget).length >= 8 &&
            normalizePhoneDigits(rawTarget) ===
              normalizePhoneDigits(docContact)))
      ) {
        return true;
      }
      return false;
    }

    if (msg.source === 'sms') {
      const msgTarget = (msg.roomOrSender || msg.sender || '').trim();
      const msgResolved = resolveContactName(msgTarget).trim();
      const msgDigits = normalizePhoneDigits(msgTarget);
      const docDigits = normalizePhoneDigits(fmPhone || docStem);

      if (
        msgDigits.length >= 8 &&
        docDigits.length >= 8 &&
        msgDigits === docDigits
      ) {
        return true;
      }
      if (
        (fmContact &&
          (msgResolved === fmContact || msgTarget === fmContact)) ||
        (docStem && (msgResolved === docStem || msgTarget === docStem))
      ) {
        return true;
      }
      return false;
    }

    if (msg.source === 'kakaotalk') {
      const room = (msg.roomOrSender || msg.sender || '').trim();
      const safeRoom = room.replace(/[\\/:*?"<>|]/g, '_').trim();
      return (
        Boolean(docStem) &&
        (room === docStem || safeRoom === docStem || docStem.includes(room))
      );
    }

    if (msg.source === 'notification' || msg.source === 'health') {
      const ym = docStem.slice(0, 7);
      return Boolean(ym) && msg.sentDate.startsWith(ym);
    }

    return false;
  };

  const refreshAllLifelogMessages = async () => {
    try {
      const [msgs, cMap] = await Promise.all([
        getAllLifelogMessages(4000),
        getMobileContactsMap().catch(() => ({})),
      ]);
      setAllLifelogMessages(msgs);
      setContactsMap(cMap);
    } catch (e) {
      console.error(e);
    }
  };

  const refreshMobilePairingInfo = async () => {
    try {
      const info = await getMobilePairingInfo();
      setMobilePairing(info);
      setSsidInputText(info.ssids.join(', '));
      const gStat = await getGeminiApiKeyStatus();
      setGeminiStatus(gStat);
      await refreshAllLifelogMessages();
    } catch (e) {
      console.error(e);
    }
  };

  const loadLifelogForDate = async (dateStr: string) => {
    try {
      const res = await getLifelogForDate(dateStr);
      setDailyMessages(res.messages);
      setDailyTransactions(res.transactions);
    } catch (e) {
      console.error(e);
    }
  };

  const refreshFinanceData = async () => {
    try {
      const txs = await getAllFinanceTransactions();
      setAllTransactions(txs);
    } catch (e) {
      console.error(e);
    }
  };

  // 통화녹음이나 문자·카톡·알림 파일이 편집/활성화되면 사이드바를 열고 해당 리스트 탭으로 자동 전환
  useEffect(() => {
    if (currentDocMobileSource) {
      setRightSidebarOpen(true);
      setMobileSidebarTab(currentDocMobileSource);
    }
  }, [currentDoc?.fullPath, currentDocMobileSource]);

  useEffect(() => {
    if (activeTabPath === 'mylore://dashboard/lifelog') {
      setRightSidebarOpen(true);
      void refreshMobilePairingInfo();
      void refreshAllLifelogMessages();
    } else if (activeTabPath === 'mylore://dashboard/finance') {
      void refreshFinanceData();
    } else if (isMobileDataSidebarMode) {
      setRightSidebarOpen(true);
      void refreshAllLifelogMessages();
    }
  }, [activeTabPath, isMobileDataSidebarMode]);

  // 활성화된 파일(모바일 라이프로그 또는 일반 폴더 트리 문서)의 사이드바 목록 위치로 자동 스크롤
  useEffect(() => {
    if (!rightSidebarOpen || !currentDoc) return;
    const timer = setTimeout(() => {
      const sidebarEl = document.querySelector(
        '.right-sidebar .sidebar-content'
      );
      if (!sidebarEl) return;
      const targetEl = sidebarEl.querySelector(
        '[data-sidebar-active="true"], .tree-node-row.active'
      ) as HTMLElement | null;
      if (targetEl) {
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 90);
    return () => clearTimeout(timer);
  }, [
    currentDoc?.fullPath,
    currentDocMobileSource,
    mobileSidebarTab,
    isMobileDataSidebarMode,
    rightSidebarOpen,
    rightTab,
    allLifelogMessages.length,
  ]);

  const scrollEditorAndPreviewToLatest = () => {
    setTimeout(() => {
      if (smsBubbleScrollRef.current) {
        smsBubbleScrollRef.current.scrollTop =
          smsBubbleScrollRef.current.scrollHeight;
      }
      if (editorRef.current) {
        editorRef.current.scrollTop = editorRef.current.scrollHeight;
      }
      if (previewPaneRef.current) {
        previewPaneRef.current.scrollTop = previewPaneRef.current.scrollHeight;
      }
    }, 60);
  };

  useEffect(() => {
    if (isCurrentDocMobileLifelog) {
      scrollEditorAndPreviewToLatest();
    }
  }, [
    currentDoc?.fullPath,
    isCurrentDocMobileLifelog,
    isCurrentDocSms,
    smsRawEditMode,
  ]);

  const handleSelectLifelogSidebarItem = async (msg: LifelogMessage) => {
    try {
      setSelectedLifelogMsgId(msg.id);
      const doc = await openLifelogItemDocument({
        source: msg.source,
        roomOrSender: msg.roomOrSender,
        attachmentUuid: msg.attachmentUuid,
        sentDate: msg.sentDate,
      });
      await refreshTree();

      if (msg.source === 'sms') {
        setSmsRawEditMode(false);
      }

      if (
        (msg.source === 'call' || msg.source === 'recording') &&
        msg.hasAudioRecording
      ) {
        loadCallAudioIntoStatusBar(
          msg.roomOrSender,
          msg.attachmentUuid,
          false
        );
      }

      const split = splitYamlFrontmatter(doc.rawContent);
      const lines = split.body.split('\n');
      const lastLineNumber = Math.max(1, lines.length);

      // 편집기 및 뷰어에서 가장 최근(하단) 기록으로 즉시 스크롤 이동
      applyLoadedDocument(doc, { lineNumber: lastLineNumber });
      scrollEditorAndPreviewToLatest();
    } catch (err) {
      setStatusMessage(`라이프로그 문서 열기 실패: ${String(err)}`);
    }
  };

  // 방식 1: AI Studio에서 키를 복사한 뒤 myLore 창으로 돌아오거나 입력창에 붙여넣기(onPaste)할 때 자동 감지 및 등록
  const tryRegisterGeminiKeyString = async (rawCandidate: string) => {
    const match = rawCandidate.match(
      /(?:AIzaSy[0-9A-Za-z_-]{33}|AQ\.[0-9A-Za-z._-]{25,})/
    );
    const extracted = match ? match[0] : rawCandidate.trim();
    if (!extracted) {
      setStatusMessage(
        '⚠️ 입력되거나 클립보드에 복사된 Gemini API 키가 없습니다.'
      );
      return false;
    }
    try {
      setIsVerifyingGemini(true);
      setStatusMessage(
        '🔄 백그라운드에서 Gemini Flash API 키 유효성 검증 중 (화면 조작이 멈추지 않습니다)...'
      );
      const stat = await saveAndVerifyGeminiApiKey(extracted);
      setGeminiStatus(stat);
      setGeminiKeyInput('');
      setAwaitingClipboardKey(false);
      const okMsg = `✅ Gemini API 키 검증 및 보안 등록 완료! (${stat.maskedKey}, 모델: ${stat.modelName} — 통화 녹음 수신 시 자동 스크립트화 활성화됨)`;
      setStatusMessage(okMsg);
      setReconcileResultMsg(okMsg);
      return true;
    } catch (err) {
      const errMsg = `❌ Gemini API 키 검증 실패: ${String(err)}`;
      setStatusMessage(errMsg);
      setReconcileResultMsg(errMsg);
      return false;
    } finally {
      setIsVerifyingGemini(false);
    }
  };

  useEffect(() => {
    if (!awaitingClipboardKey) return;
    const onFocusWindow = async () => {
      try {
        const clipText = await navigator.clipboard.readText();
        if (
          clipText &&
          /(?:AIzaSy[0-9A-Za-z_-]{33}|AQ\.[0-9A-Za-z._-]{25,})/.test(clipText)
        ) {
          await tryRegisterGeminiKeyString(clipText);
        }
      } catch {
        // clipboard read permission ignored on focus
      }
    };
    window.addEventListener('focus', onFocusWindow);
    return () => window.removeEventListener('focus', onFocusWindow);
  }, [awaitingClipboardKey]);

  useEffect(() => {
    if (!mobilePairing) return;
    // QR 코드는 항상 Base64 Deep-Link (myloresync://pair?data=<Base64>) 만 제공
    QRCode.toDataURL(mobilePairing.qrBase64, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 220,
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
    })
      .then((url) => setQrDataUrl(url))
      .catch((err) => console.error('QR 생성 오류:', err));
  }, [mobilePairing]);

  // 선택된 문서의 날짜 또는 기본 날짜가 바뀔 때 라이프로그 갱신
  useEffect(() => {
    const docDate =
      currentDoc?.frontmatter['date'] ||
      currentDoc?.frontmatter['start'] ||
      currentDoc?.relativePath.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ||
      selectedDate;
    if (docDate && /^\d{4}-\d{2}-\d{2}$/.test(docDate)) {
      setSelectedDate(docDate);
      loadLifelogForDate(docDate);
    }
  }, [currentDoc]);

  // 3단계: 은행/카드사 엑셀 업로드
  const handleExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = await file.arrayBuffer();
      // xlsx(약 400 KB)는 엑셀 업로드 시에만 필요하므로 지연 로딩하여 초기 번들 크기를 줄임
      const XLSX = await import('xlsx');
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
        firstSheet,
        { defval: '' }
      );

      const mappedRows = jsonRows
        .map((r) => {
          const dateVal = String(
            r['거래일시'] ||
              r['승인일'] ||
              r['일자'] ||
              r['날짜'] ||
              selectedDate
          )
            .slice(0, 10)
            .replace(/\./g, '-');
          const timeVal = String(r['시간'] || r['승인시간'] || '12:00:00');
          const instVal = String(
            r['금융사'] || r['카드사'] || r['은행'] || '엑셀명세서'
          );
          const merchantVal = String(
            r['가맹점'] || r['적요'] || r['내용'] || r['사용처'] || '기타내역'
          );
          const rawAmt = String(
            r['금액'] || r['이용금액'] || r['출금액'] || r['승인금액'] || '0'
          ).replace(/[^0-9-]/g, '');
          const amount = parseInt(rawAmt || '0', 10);
          return {
            txDate: /^\d{4}-\d{2}-\d{2}$/.test(dateVal)
              ? dateVal
              : selectedDate,
            txTime: timeVal,
            institution: instVal,
            txType: 'expense',
            amount,
            merchant: merchantVal,
            category: String(r['분류'] || r['카테고리'] || '일반'),
            memo: `엑셀 파일(${file.name}) 적재`,
            source: 'excel' as const,
          };
        })
        .filter((r) => r.amount > 0);

      const summary = await importFinanceRows(mappedRows);
      await refreshFinanceData();
      await loadLifelogForDate(selectedDate);
      setReconcileResultMsg(
        `✅ [3단계 엑셀 대조 결과] 총 ${mappedRows.length}건 분석 → 확정(verified) ${summary.reconciledExisting}건, 신규 적재 ${summary.insertedNew}건`
      );
    } catch (err) {
      setReconcileResultMsg(`엑셀 파일 처리 오류: ${String(err)}`);
    } finally {
      if (excelInputRef.current) excelInputRef.current.value = '';
    }
  };

  return {
    selectedDate,
    setSelectedDate,
    dailyMessages,
    setDailyMessages,
    dailyTransactions,
    setDailyTransactions,
    allTransactions,
    setAllTransactions,
    reconcileResultMsg,
    setReconcileResultMsg,
    mobilePairing,
    setMobilePairing,
    qrDataUrl,
    setQrDataUrl,
    ssidInputText,
    setSsidInputText,
    geminiStatus,
    setGeminiStatus,
    geminiKeyInput,
    setGeminiKeyInput,
    isVerifyingGemini,
    setIsVerifyingGemini,
    awaitingClipboardKey,
    setAwaitingClipboardKey,
    isTranscribingSingleCall,
    setIsTranscribingSingleCall,
    lifelogDashboardTab,
    setLifelogDashboardTab,
    mobileSidebarTab,
    setMobileSidebarTab,
    allLifelogMessages,
    setAllLifelogMessages,
    mobilePersonFilter,
    setMobilePersonFilter,
    mobileSourceFilter,
    setMobileSourceFilter,
    mobileSyncProgress,
    setMobileSyncProgress,
    financeSubTab,
    setFinanceSubTab,
    mobileContextMenu,
    setMobileContextMenu,
    contactsMap,
    setContactsMap,
    smsRawEditMode,
    setSmsRawEditMode,
    isRetryingCalls,
    setIsRetryingCalls,
    selectedLifelogMsgId,
    setSelectedLifelogMsgId,
    smsBubbleScrollRef,
    excelInputRef,
    resolveContactName,
    isLifelogMessageMatchingCurrentDoc,
    refreshAllLifelogMessages,
    refreshMobilePairingInfo,
    loadLifelogForDate,
    refreshFinanceData,
    handleSelectLifelogSidebarItem,
    tryRegisterGeminiKeyString,
    handleExcelUpload,
  };
}
