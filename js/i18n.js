// UI language support: English (default) + Korean.
// - Parameter screen strings come from lang_kr.xml (Ref -> Korean map).
// - Missing translations fall back to English (original config text).
// - Removed signature entries simply have no map entry -> English shown.
const STATE_KEY = 'kbar.lang';
let current = 'eng';
try {
  const saved = localStorage.getItem(STATE_KEY);
  if (saved === 'kor' || saved === 'eng') current = saved;
} catch (err) {}

let dict = null; // Map<string,string> | null (kor only)
let dictPromise = null;

async function loadDict() {
  const res = await fetch('lang_kr.xml', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Cannot load lang_kr.xml (${res.status})`);
  const xml = await res.text();
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const perr = doc.querySelector('parsererror');
  if (perr) throw new Error('Language XML parse error: ' + perr.textContent.slice(0, 200));
  const map = new Map();
  const root = doc.documentElement;
  for (let n = root.firstElementChild; n; n = n.nextElementSibling) {
    if (n.localName !== 'ENTRY') continue;
    const ref = n.getAttribute('Ref');
    if (ref === null || ref === '') continue;
    const body = (n.textContent || '').replace(/\s+/g, ' ').trim();
    if (!body) continue; // empty translation -> English fallback
    map.set(ref, body);
  }
  return map;
}

export function getLang() {
  return current;
}

export async function ensureLang(lang) {
  if (lang !== 'kor' && lang !== 'eng') lang = 'eng';
  current = lang;
  try { localStorage.setItem(STATE_KEY, lang); } catch (err) {}
  if (lang === 'kor' && !dict) {
    if (!dictPromise) dictPromise = loadDict().catch((err) => { dictPromise = null; throw err; });
    dict = await dictPromise;
  }
  document.documentElement.lang = lang === 'kor' ? 'ko' : 'en';
  return lang;
}

// Translate an original (English) config string. Eng -> identity, Kor -> map or English fallback.
export function tr(text) {
  if (current !== 'kor' || text === null || text === undefined) return text;
  if (!dict) return text;
  const hit = dict.get(text);
  return hit !== undefined ? hit : text;
}

// Shell (menu/dialog/toolbar) strings, English source -> Korean.
const SHELL_KO = {
  'File': '파일',
  'Parameter': '파라미터',
  'Info': '정보',
  'Help': '도움말',
  'Event Log': '이벤트 로그',
  'About': '정보',
  'Load ...': '불러오기 ...',
  'Save ...': '저장 ...',
  'Exit': '종료',
  'Reset to Defaults': '기본값으로 초기화',
  'Go to Page': '페이지로 이동',
  'Load': '불러오기',
  'Save': '저장',
  'Bluetooth': '블루투스',
  'no Connection': '연결 없음',
  'connected': '연결됨',
  'waiting': '대기 중',
  'busy': '전송 중',
  'timeout': '시간 초과',
  'error': '오류',
  'Active bank': '활성 뱅크',
  'Load actual Bank from File': '파일에서 현재 뱅크 불러오기',
  'Save actual Bank to File': '현재 뱅크를 파일에 저장',
  'Connect Bluetooth SPP COM port': '블루투스 SPP COM 포트 연결',
  'Minimize': '최소화',
  'Maximize': '최대화',
  'Close': '닫기',
  'Restore': '복원',
  'OK': '확인',
  'Cancel': '취소',
  'Clear': '지우기',
  'Apply': '적용',
  'Reconnect': '다시 연결',
  'Disconnect': '연결 해제',
  'Connect COM Port': 'COM 포트 연결',
  'Change Port': '포트 변경',
  'Simulation': '시뮬레이션',
  'Warning': '경고',
  'Information': '정보',
  'Connection error': '연결 오류',
  'Load error': '불러오기 오류',
  'Save error': '저장 오류',
  'Startup error': '시작 오류',
  'About Setup VStabi': 'Setup VStabi 정보',
  'Bluetooth Connection': '블루투스 연결',
  'Connect Bluetooth (SPP / BLE)': '블루투스 연결 (SPP / BLE)',
  'Bluetooth connection': '블루투스 연결',
  'Connect to a paired SPP module or scan for a nearby BLE module. The link uses the same VStabi protocol at 9600 8N1 over a raw Bluetooth stream.': '페어링된 SPP 모듈에 연결하거나 주변 BLE 모듈을 검색합니다. 링크는 동일한 VStabi 프로토콜을 9600 8N1 raw Bluetooth 스트림으로 사용합니다.',
  'Current link': '현재 링크',
  'Requesting Bluetooth permission ...': '블루투스 권한 요청 중 ...',
  'Bluetooth permission': '블루투스 권한',
  'Loading paired devices ...': '페어링된 기기 불러오는 중 ...',
  'Paired devices (SPP)': '페어링된 기기 (SPP)',
  'No paired devices. Pair the module in Android Bluetooth settings first.': '페어링된 기기가 없습니다. 먼저 Android 블루투스 설정에서 모듈을 페어링하세요.',
  'Scanning for BLE devices ...': 'BLE 기기 검색 중 ...',
  'Nearby BLE devices': '주변 BLE 기기',
  'No supported BLE module found.': '지원되는 BLE 모듈을 찾지 못했습니다.',
  'Rescan': '다시 검색',
  'Connecting to': '연결 중:',
  'Preset': '프리셋',
  'Load Parameters': '파라미터 불러오기',
  'Save Parameters': '파라미터 저장',
  'Start Page': '시작 페이지',
  'End Page': '끝 페이지',
  'Leave empty to use the full range.': '비워 두면 전체 범위를 사용합니다.',
  'Apply only parameters shown on pages': '페이지에 표시된 파라미터만 적용',
  'End Page (leave empty for a single page)': '끝 페이지 (단일 페이지는 비워 둠)',
  'Save only parameters shown on pages': '페이지에 표시된 파라미터만 저장',
  'Authorized ports': '인증된 포트',
  'Available in this browser:': '이 브라우저에서 사용 가능:',
  'No ports have been authorized yet. Use Connect COM Port to choose one.': '아직 인증된 포트가 없습니다. COM 포트 연결을 눌러 선택하세요.',
  'Are you sure you want to execute this function?': '이 기능을 실행하시겠습니까?',
  'Are you sure you want to change this setting ?': '이 설정을 변경하시겠습니까?',
  'Reset every parameter to the values defined in config_53.xml?': 'config_53.xml에 정의된 값으로 모든 파라미터를 초기화하시겠습니까?',
  'The selected file is not a valid XML parameter file.': '선택한 파일은 올바른 XML 파라미터 파일이 아닙니다.',
  'The selected file does not contain a REGISTER element.': '선택한 파일에 REGISTER 요소가 없습니다.',
  'No parameter values were found in the file.': '파일에서 파라미터 값을 찾지 못했습니다.',
  'Nothing to save.': '저장할 내용이 없습니다.',
  'Serial traffic and application events.': '시리얼 통신 및 앱 이벤트.',
  'Get All Entries': '전체 가져오기',
  'Get 100 Entries': '100개 가져오기',
  'Connect the controller, then fetch its stored log.': '컨트롤러를 연결한 뒤 저장된 로그를 가져오세요.',
  'No entries yet. Use Get All Entries or Get 100 Entries.': '아직 항목이 없습니다. 전체 가져오기 또는 100개 가져오기를 누르세요.',
  'Fetching log from controller ...': '컨트롤러에서 로그 가져오는 중 ...',
  'Not connected. Connect the controller first.': '연결되지 않았습니다. 먼저 컨트롤러를 연결하세요.',
  'Retrying log request ...': '로그 요청 재시도 중 ...',
  'Close the current connection and start simulation?': '현재 연결을 닫고 시뮬레이션을 시작할까요?',
  'Loading VStabi 5.3 ...': 'VStabi 5.3 불러오는 중 ...',
  'Setup VStabi closed': 'Setup VStabi 종료됨',
  'Reload the page to open the application again.': '다시 열려면 페이지를 새로고침하세요.',
  'Reopen': '다시 열기',
};

export function trShell(text) {
  if (current !== 'kor') return text;
  return SHELL_KO[text] !== undefined ? SHELL_KO[text] : text;
}

export function trBank(n) {
  return current === 'kor' ? `뱅크 ${n}` : `Bank ${n}`;
}
