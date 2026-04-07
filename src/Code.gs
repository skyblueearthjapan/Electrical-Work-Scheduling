/**
 * Code.gs — エントリーポイント + API ルーティング
 *
 * 全 API は google.script.run で呼ばれ、Permissions チェックを経由する。
 * ハードコードされた ID なし(R2 対応)。
 */

/**
 * WebApp エントリーポイント。
 */
function doGet(e) {
  try {
    // 初期プロパティ未設定時はセットアップ案内画面
    const dataSS = getPropOrNull_(CONFIG.PROPS_KEYS.DATA_SPREADSHEET_ID);
    if (!dataSS) {
      return HtmlService.createHtmlOutput(
        '<h2>セットアップ未完了</h2>' +
        '<p>GAS エディタから <code>setupScriptProperties()</code> を実行してください。</p>'
      ).setTitle('電気工事スケジューリング — セットアップ');
    }

    const template = HtmlService.createTemplateFromFile('index');
    template.userEmail = Session.getActiveUser().getEmail() || '';
    template.userRole = getUserRole_(template.userEmail);
    return template.evaluate()
      .setTitle('電気工事スケジューリング')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } catch (err) {
    return HtmlService.createHtmlOutput(
      '<h2>エラー</h2><pre>' + escapeForHtml_(err.message) + '</pre>'
    );
  }
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function escapeForHtml_(s) {
  return String(s).replace(/[&<>"']/g, function(c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/* ===================== 権限管理 ===================== */

function getCurrentUserEmail_() {
  return (Session.getActiveUser().getEmail() || '').toLowerCase().trim();
}

function getUserRole_(email) {
  if (!email) return 'none';
  try {
    const sh = getSheet_(CONFIG.SHEETS.PERMISSIONS);
    const data = sh.getDataRange().getValues();
    if (data.length < 2) return 'none';
    const headers = data[0];
    const idxEmail = headers.indexOf('email');
    const idxRole = headers.indexOf('role');
    const idxActive = headers.indexOf('isActive');
    for (let i = 1; i < data.length; i++) {
      const e = String(data[i][idxEmail] || '').toLowerCase().trim();
      if (e === email && data[i][idxActive] === true) {
        return String(data[i][idxRole] || 'viewer');
      }
    }
  } catch (err) {
    Logger.log('getUserRole_ error: ' + err.message);
  }
  return 'none';
}

function requireEditor_() {
  const email = getCurrentUserEmail_();
  const role = getUserRole_(email);
  if (role !== 'editor') {
    throw new Error('編集権限がありません: ' + email);
  }
  return email;
}

function requireViewer_() {
  const email = getCurrentUserEmail_();
  const role = getUserRole_(email);
  if (role !== 'editor' && role !== 'viewer') {
    throw new Error('閲覧権限がありません: ' + email);
  }
  return email;
}

/* ===================== API Routes ===================== */

/**
 * フロント初期化時に呼ばれる。全ページプリロード用データを一括返却。
 */
function api_bootstrap() {
  requireViewer_();
  return sanitize_({
    schemaVersion: CONFIG.SCHEMA_VERSION,
    user: {
      email: getCurrentUserEmail_(),
      role: getUserRole_(getCurrentUserEmail_())
    },
    processes: DataService.listProcesses(),
    contractors: DataService.listContractors(),
    okuSchedules: DataService.listOkuSchedules(),
    contractorSchedules: DataService.listContractorSchedules(),
    todos: DataService.listTodos(),
    jobs: DataService.listJobsCache(),
    ghostSchedules: [],  // Phase 4 で中継GAS経由
    today: Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd')
  });
}

function api_searchJobs(query) {
  requireViewer_();
  return DataService.searchJobs(query || '');
}

/* -------- OkuSchedule -------- */

function api_createOkuSchedule(payload) {
  requireEditor_();
  return DataService.createOkuSchedule(payload);
}

function api_updateOkuSchedule(scheduleId, patch, expectedUpdatedAt) {
  requireEditor_();
  return DataService.updateOkuSchedule(scheduleId, patch, expectedUpdatedAt);
}

function api_deleteOkuSchedule(scheduleId, expectedUpdatedAt) {
  requireEditor_();
  return DataService.deleteOkuSchedule(scheduleId, expectedUpdatedAt);
}

/* -------- ContractorSchedule -------- */

function api_createContractorSchedule(payload) {
  requireEditor_();
  return DataService.createContractorSchedule(payload);
}

function api_updateContractorSchedule(scheduleId, patch, expectedUpdatedAt) {
  requireEditor_();
  return DataService.updateContractorSchedule(scheduleId, patch, expectedUpdatedAt);
}

function api_deleteContractorSchedule(scheduleId, expectedUpdatedAt) {
  requireEditor_();
  return DataService.deleteContractorSchedule(scheduleId, expectedUpdatedAt);
}

/* -------- ProcessMaster / Contractors -------- */

function api_createProcess(name, color) {
  requireEditor_();
  return DataService.createProcess(name, color);
}

function api_updateProcess(processId, patch) {
  requireEditor_();
  return DataService.updateProcess(processId, patch);
}

function api_updateContractor(contractorId, patch) {
  requireEditor_();
  return DataService.updateContractor(contractorId, patch);
}

/* -------- Todo -------- */

function api_createTodo(payload) {
  requireEditor_();
  return DataService.createTodo(payload);
}

function api_updateTodo(todoId, patch) {
  requireEditor_();
  return DataService.updateTodo(todoId, patch);
}

function api_deleteTodo(todoId) {
  requireEditor_();
  return DataService.deleteTodo(todoId);
}

/* -------- JobsCache refresh -------- */

function api_refreshJobsCache() {
  requireEditor_();
  return DataService.refreshJobsCache();
}

/* -------- Ghost (Phase 4) -------- */

function api_getGhostSchedules(jobList, startDate, endDate) {
  requireViewer_();
  // Phase 4: 中継GAS呼び出し実装。今は空配列返却。
  return [];
}

/* ===================== Utilities ===================== */

/**
 * Date→文字列変換(GAS→Frontend)
 */
function sanitize_(obj) {
  if (obj === null || obj === undefined) return obj;
  if (obj instanceof Date) {
    return Utilities.formatDate(obj, 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ssXXX");
  }
  if (Array.isArray(obj)) return obj.map(sanitize_);
  if (typeof obj === 'object') {
    const out = {};
    Object.keys(obj).forEach(function(k) { out[k] = sanitize_(obj[k]); });
    return out;
  }
  return obj;
}
