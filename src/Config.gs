/**
 * Config.gs — 設定定数
 *
 * 重要な方針:
 * - スプレッドシートID/カレンダーID等は PropertiesService 経由で取得する。
 * - 初回起動時に setupScriptProperties() を実行して登録する。
 * - コードに直接ハードコードしない(セキュリティレビュー R2 対応)。
 */

const CONFIG = {
  SCHEMA_VERSION: '1.0.0',

  SHEETS: {
    OKU_SCHEDULE: 'OkuSchedule',
    CONTRACTOR_SCHEDULE: 'ContractorSchedule',
    ELECTRICAL_PROCESS_MASTER: 'ElectricalProcessMaster',
    CONTRACTORS: 'Contractors',
    TODO_LIST: 'TodoList',
    SYNC_STATE: 'SyncState',
    CONFLICT_LOG: 'ConflictLog',
    PERMISSIONS: 'Permissions',
    JOBS_CACHE: 'JobsCache',
    SCHEMA_VERSION: 'SchemaVersion',
    AUDIT_LOG: 'AuditLog',
    GANTT_OKU_ROWS: 'GanttOkuRows',
    DAILY_MEMO: 'DailyMemo'
  },

  HEADERS: {
    OKU_SCHEDULE: [
      'scheduleId', '工番', 'processId', '工程名', 'start', 'end',
      '色', 'メモ', 'googleEventId', 'etag', 'lastSyncedAt',
      'deletedAt', 'updatedAt', 'updatedBy'
    ],
    CONTRACTOR_SCHEDULE: [
      // Calendar連携列は意図的に予約(現状NULL運用、業者側連携なし)
      'scheduleId', 'contractorId', '工番', 'processId', '工程名',
      'start', 'end', '色', 'メモ',
      'googleEventId', 'etag', 'lastSyncedAt',
      'deletedAt', 'updatedAt', 'updatedBy'
    ],
    ELECTRICAL_PROCESS_MASTER: [
      'processId', '工程名', '種別', '表示順', '色', '有効', '備考'
    ],
    CONTRACTORS: [
      'contractorId', '業者名', '担当者', '電話番号', 'メール',
      '識別色', '表示順', '有効', '備考', '短縮名'
    ],
    TODO_LIST: [
      'todoId', 'scopeType', 'contractorId', 'text', 'isDone',
      'sortOrder', 'dueDate', 'createdAt', 'updatedAt', 'updatedBy',
      'completedDate'
    ],
    SYNC_STATE: ['key', 'value', 'updatedAt'],
    CONFLICT_LOG: [
      'logId', 'occurredAt', 'scheduleId', 'conflictType',
      'sheetVersion', 'calendarVersion', 'resolution'
    ],
    PERMISSIONS: ['email', 'role', 'isActive', 'updatedAt'],
    JOBS_CACHE: [
      '工番', '受注先', '納入先', '納入先住所', '品名', '数量',
      'cachedAt'
    ],
    SCHEMA_VERSION: ['version', 'appliedAt', 'note'],
    AUDIT_LOG: ['timestamp', 'email', 'action', 'params', 'result'],
    GANTT_OKU_ROWS: ['rowId', '工番', 'sortOrder', 'createdAt', 'updatedAt', 'updatedBy'],
    DAILY_MEMO: ['date', 'text', 'preview', 'updatedAt', 'updatedBy']
  },

  INITIAL_PROCESSES: [
    'ハード設計', 'ハード承認図提出', 'ハード承認図返却期間',
    'ソフト設計', 'タッチパネル設計', '電気工事',
    'デバック', '試運転', '動作確認',
    '立会', '出荷', '現地試運転', '現地立会'
  ],

  INITIAL_CONTRACTORS: [
    { name: 'H・Y・Tシステム',              color: '#60A5FA' },
    { name: '有限会社サンスイ',              color: '#10B981' },
    { name: '坂野電気工業所',                color: '#FACC15' },
    { name: '株式会社内山電機製作所',        color: '#8B5CF6' },
    { name: '株式会社桜井電装',              color: '#EC4899' },
    { name: 'RCエンジニアリング株式会社',    color: '#22D3EE' }
  ],

  COLOR_PALETTE: [
    '#60A5FA', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899',
    '#22D3EE', '#F87171', '#A78BFA', '#34D399', '#FB923C',
    '#FBBF24', '#818CF8', '#F472B6', '#4ADE80'
  ],

  GHOST_PROCESSES: {
    P065: { name: '電気工事',             color: '#1F4E79' },
    P080: { name: 'ロボットセットアップ', color: '#7030A0' },
    M100: { name: '立会',                 color: '#FFD966' },
    M140: { name: '出荷',                 color: '#FFC000' },
    P150: { name: '据付/現地工事',        color: '#548235' }
  },

  SAVE_QUEUE: {
    DEBOUNCE_MS: 3000,
    MAX_RETRIES: 3,
    LOCK_TIMEOUT_MS: 10000
  },

  GANTT: {
    CELL_WIDTH: 32,
    DEFAULT_DAYS: 180,
    AVAILABLE_DAYS: [30, 60, 90, 180, 365]
  },

  PROPS_KEYS: {
    DATA_SPREADSHEET_ID: 'DATA_SPREADSHEET_ID',
    JOB_MASTER_SPREADSHEET_ID: 'JOB_MASTER_SPREADSHEET_ID',
    BRIDGE_GAS_URL: 'BRIDGE_GAS_URL',
    BRIDGE_GAS_TOKEN: 'BRIDGE_GAS_TOKEN',
    CALENDAR_ID: 'CALENDAR_ID',
    CAL_SYNC_TOKEN: 'CAL_SYNC_TOKEN',
    CAL_LAST_FULL_SYNC: 'CAL_LAST_FULL_SYNC',
    OPENAI_API_KEY: 'OPENAI_API_KEY',
    GEMINI_API_KEY: 'GEMINI_API_KEY'
  },

  AI: {
    PROVIDER: 'gemini',                  // 'gemini' | 'openai'
    MODEL: 'gemini-2.5-flash',           // 2026/4 時点の安定版・無料枠あり
    // 複数行入力(items 配列)で応答が切れないよう 4096 に拡大。
    // Gemini 2.5 Flash は thinking tokens も消費するため余裕を確保。
    MAX_TOKENS: 4096,
    TEMPERATURE: 0,
    INPUT_MAX_CHARS: 2000,
    RATE_LIMIT_PER_MIN: 30
  }
};

/**
 * Script Propertiesから値を取得。未設定なら例外。
 */
function getProp_(key) {
  const v = PropertiesService.getScriptProperties().getProperty(key);
  if (!v) {
    throw new Error('Script Property "' + key + '" が未設定です。setupScriptProperties() を実行してください。');
  }
  return v;
}

function getPropOrNull_(key) {
  return PropertiesService.getScriptProperties().getProperty(key) || null;
}

function setProp_(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, value);
}

/**
 * データSSを取得。
 */
function getDataSS_() {
  return SpreadsheetApp.openById(getProp_(CONFIG.PROPS_KEYS.DATA_SPREADSHEET_ID));
}

function getSheet_(name) {
  const sh = getDataSS_().getSheetByName(name);
  if (!sh) throw new Error('Sheet not found: ' + name);
  return sh;
}
