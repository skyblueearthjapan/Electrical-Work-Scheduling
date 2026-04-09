/**
 * DataService.gs — CRUD 実装
 *
 * 方針:
 * - ヘッダ名で列解決(列順変更に耐性)
 * - LockService で楽観ロック
 * - updatedAt による競合検知
 * - XSS 対策はフロント側 textContent で実施
 */

const DataService = (function() {

  function getSheetByName_(name) {
    return getSheet_(name);
  }

  function readAll_(sheetName) {
    const sh = getSheetByName_(sheetName);
    const data = sh.getDataRange().getValues();
    if (data.length < 2) return { headers: data[0] || [], rows: [] };
    const headers = data[0];
    const rows = data.slice(1).map(function(row) {
      const obj = {};
      headers.forEach(function(h, i) { obj[h] = row[i]; });
      obj._rowIndex = 0; // filled later if needed
      return obj;
    });
    return { headers: headers, rows: rows };
  }

  function findRowIndex_(sh, idColumn, idValue) {
    const data = sh.getDataRange().getValues();
    if (data.length < 2) return -1;
    const headers = data[0];
    const idx = headers.indexOf(idColumn);
    if (idx === -1) return -1;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][idx]) === String(idValue)) return i + 1; // 1-indexed
    }
    return -1;
  }

  function nowISO_() {
    return Utilities.formatDate(new Date(), 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ss");
  }

  function uuid_() {
    return Utilities.getUuid();
  }

  function withLock_(fn) {
    const lock = LockService.getScriptLock();
    const ok = lock.tryLock(CONFIG.SAVE_QUEUE.LOCK_TIMEOUT_MS);
    if (!ok) {
      const e = new Error('ロック取得タイムアウト。しばらくして再試行してください。');
      e.code = 429;
      throw e;
    }
    try { return fn(); } finally { lock.releaseLock(); }
  }

  function appendRow_(sheetName, obj) {
    const sh = getSheetByName_(sheetName);
    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    const row = headers.map(function(h) { return obj.hasOwnProperty(h) ? obj[h] : ''; });
    sh.appendRow(row);
  }

  function updateRowByKey_(sheetName, idColumn, idValue, patch, expectedUpdatedAt) {
    const sh = getSheetByName_(sheetName);
    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    const rowIdx = findRowIndex_(sh, idColumn, idValue);
    if (rowIdx === -1) throw new Error('レコードが見つかりません: ' + idValue);

    // Optimistic lock
    if (expectedUpdatedAt) {
      const uaIdx = headers.indexOf('updatedAt');
      if (uaIdx !== -1) {
        const current = sh.getRange(rowIdx, uaIdx + 1).getValue();
        if (current) {
          // Sheets が Date 自動変換するため getTime() で比較
          const curMs = new Date(current).getTime();
          const expMs = new Date(expectedUpdatedAt).getTime();
          if (curMs !== expMs) {
            const e = new Error('他のユーザーが更新しました。最新を取得してください。');
            e.code = 409;
            throw e;
          }
        }
      }
    }

    // Apply patch
    Object.keys(patch).forEach(function(k) {
      const idx = headers.indexOf(k);
      if (idx !== -1) sh.getRange(rowIdx, idx + 1).setValue(patch[k]);
    });

    // updatedAt / updatedBy
    const uaIdx = headers.indexOf('updatedAt');
    const ubIdx = headers.indexOf('updatedBy');
    const now = nowISO_();
    if (uaIdx !== -1) sh.getRange(rowIdx, uaIdx + 1).setValue(now);
    if (ubIdx !== -1) sh.getRange(rowIdx, ubIdx + 1).setValue(getCurrentUserEmail_());

    return { updatedAt: now };
  }

  function deleteRowByKey_(sheetName, idColumn, idValue) {
    const sh = getSheetByName_(sheetName);
    const rowIdx = findRowIndex_(sh, idColumn, idValue);
    if (rowIdx === -1) return false;
    sh.deleteRow(rowIdx);
    return true;
  }

  /* ======================================================= */

  function listProcesses() {
    const { rows } = readAll_(CONFIG.SHEETS.ELECTRICAL_PROCESS_MASTER);
    return rows.filter(function(r) { return r['有効'] !== false; })
      .sort(function(a, b) { return (a['表示順'] || 0) - (b['表示順'] || 0); });
  }

  function listContractors() {
    const { rows } = readAll_(CONFIG.SHEETS.CONTRACTORS);
    return rows.filter(function(r) { return r['有効'] !== false; })
      .sort(function(a, b) { return (a['表示順'] || 0) - (b['表示順'] || 0); });
  }

  function listOkuSchedules() {
    const { rows } = readAll_(CONFIG.SHEETS.OKU_SCHEDULE);
    return rows.filter(function(r) { return !r['deletedAt']; });
  }

  function listContractorSchedules() {
    const { rows } = readAll_(CONFIG.SHEETS.CONTRACTOR_SCHEDULE);
    return rows.filter(function(r) { return !r['deletedAt']; });
  }

  function listTodos() {
    const { rows } = readAll_(CONFIG.SHEETS.TODO_LIST);
    return rows.sort(function(a, b) { return (a['sortOrder'] || 0) - (b['sortOrder'] || 0); });
  }

  function listJobsCache() {
    const { rows } = readAll_(CONFIG.SHEETS.JOBS_CACHE);
    return rows;
  }

  function searchJobs(query) {
    const jobs = listJobsCache();
    if (!query) return jobs.slice(0, 50);
    const q = String(query).toLowerCase();
    return jobs.filter(function(j) {
      return String(j['工番'] || '').toLowerCase().indexOf(q) !== -1 ||
             String(j['受注先'] || '').toLowerCase().indexOf(q) !== -1 ||
             String(j['納入先'] || '').toLowerCase().indexOf(q) !== -1 ||
             String(j['品名'] || '').toLowerCase().indexOf(q) !== -1;
    }).slice(0, 50);
  }

  /* -------- OkuSchedule -------- */

  function createOkuSchedule(payload) {
    const row = withLock_(function() {
      // クライアント発番の scheduleId を尊重(Store のローカル状態と一致させるため)
      const id = (payload && payload.scheduleId) ? String(payload.scheduleId) : uuid_();
      const now = nowISO_();
      const r = {
        scheduleId: id,
        工番: payload.工番 || '',
        processId: payload.processId || '',
        工程名: payload.工程名 || '',
        start: payload.start || '',
        end: payload.end || '',
        色: payload.色 || '',
        メモ: payload.メモ || '',
        googleEventId: '',
        etag: '',
        lastSyncedAt: '',
        deletedAt: '',
        updatedAt: now,
        updatedBy: getCurrentUserEmail_()
      };
      appendRow_(CONFIG.SHEETS.OKU_SCHEDULE, r);
      return r;
    });
    // Calendar 同期は lock 外で実行(Calendar API のレイテンシでロックを長く保持しないため)
    try { pushOkuRowToCalendar(row, 'create'); } catch (e) { Logger.log('[Calendar hook] create: ' + e.message); }
    return row;
  }

  function updateOkuSchedule(id, patch, expectedUpdatedAt) {
    const result = withLock_(function() {
      return updateRowByKey_(CONFIG.SHEETS.OKU_SCHEDULE, 'scheduleId', id, patch, expectedUpdatedAt);
    });
    try {
      const fresh = findOkuRowById_(id);
      if (fresh) pushOkuRowToCalendar(fresh, 'update');
    } catch (e) { Logger.log('[Calendar hook] update: ' + e.message); }
    return result;
  }

  function deleteOkuSchedule(id, expectedUpdatedAt) {
    // 削除前に googleEventId を取得しておく(tombstone 後でも同じ行に残るが念のため)
    let snapshot = null;
    try { snapshot = findOkuRowById_(id); } catch (e) {}
    const result = withLock_(function() {
      // Tombstone (論理削除) — 削除はべき等なので楽観ロック無効化
      return updateRowByKey_(CONFIG.SHEETS.OKU_SCHEDULE, 'scheduleId', id,
        { deletedAt: nowISO_() }, null);
    });
    try {
      if (snapshot) pushOkuRowToCalendar(snapshot, 'delete');
    } catch (e) { Logger.log('[Calendar hook] delete: ' + e.message); }
    return result;
  }

  /** scheduleId で OkuSchedule 行を1件取得(Calendar 同期用) */
  function findOkuRowById_(id) {
    const sh = getSheetByName_(CONFIG.SHEETS.OKU_SCHEDULE);
    const data = sh.getDataRange().getValues();
    if (data.length < 2) return null;
    const headers = data[0];
    const idIdx = headers.indexOf('scheduleId');
    if (idIdx === -1) return null;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][idIdx]) === String(id)) {
        const obj = {};
        headers.forEach(function(h, k) { obj[h] = data[i][k]; });
        return obj;
      }
    }
    return null;
  }

  /* -------- ContractorSchedule -------- */

  function createContractorSchedule(payload) {
    return withLock_(function() {
      // クライアント発番の scheduleId を尊重
      const id = (payload && payload.scheduleId) ? String(payload.scheduleId) : uuid_();
      const now = nowISO_();
      const row = {
        scheduleId: id,
        contractorId: payload.contractorId || '',
        工番: payload.工番 || '',
        processId: payload.processId || '',
        工程名: payload.工程名 || '',
        start: payload.start || '',
        end: payload.end || '',
        色: payload.色 || '',
        メモ: payload.メモ || '',
        googleEventId: '',
        etag: '',
        lastSyncedAt: '',
        deletedAt: '',
        updatedAt: now,
        updatedBy: getCurrentUserEmail_()
      };
      appendRow_(CONFIG.SHEETS.CONTRACTOR_SCHEDULE, row);
      return row;
    });
  }

  function updateContractorSchedule(id, patch, expectedUpdatedAt) {
    return withLock_(function() {
      return updateRowByKey_(CONFIG.SHEETS.CONTRACTOR_SCHEDULE, 'scheduleId', id, patch, expectedUpdatedAt);
    });
  }

  function deleteContractorSchedule(id, expectedUpdatedAt) {
    return withLock_(function() {
      // 削除はべき等なので楽観ロック無効化
      return updateRowByKey_(CONFIG.SHEETS.CONTRACTOR_SCHEDULE, 'scheduleId', id,
        { deletedAt: nowISO_() }, null);
    });
  }

  /* -------- ProcessMaster / Contractors -------- */

  function createProcess(name, color) {
    return withLock_(function() {
      const sh = getSheetByName_(CONFIG.SHEETS.ELECTRICAL_PROCESS_MASTER);
      const existing = readAll_(CONFIG.SHEETS.ELECTRICAL_PROCESS_MASTER);
      const maxOrder = existing.rows.reduce(function(m, r) {
        return Math.max(m, r['表示順'] || 0);
      }, 0);
      const nextNum = existing.rows.length + 1;
      const processId = 'EP' + String(nextNum).padStart(3, '0');
      const row = {
        processId: processId,
        工程名: name,
        種別: 'range',
        表示順: maxOrder + 10,
        色: color || _pickRandomColor(),
        有効: true,
        備考: ''
      };
      appendRow_(CONFIG.SHEETS.ELECTRICAL_PROCESS_MASTER, row);
      return row;
    });
  }

  function updateProcess(processId, patch) {
    return withLock_(function() {
      return updateRowByKey_(CONFIG.SHEETS.ELECTRICAL_PROCESS_MASTER, 'processId', processId, patch, null);
    });
  }

  function updateContractor(contractorId, patch) {
    return withLock_(function() {
      return updateRowByKey_(CONFIG.SHEETS.CONTRACTORS, 'contractorId', contractorId, patch, null);
    });
  }

  function _pickRandomColor() {
    const palette = CONFIG.COLOR_PALETTE;
    return palette[Math.floor(Math.random() * palette.length)];
  }

  /* -------- Todo -------- */

  function createTodo(payload) {
    return withLock_(function() {
      const id = uuid_();
      const now = nowISO_();
      const row = {
        todoId: id,
        scopeType: payload.scopeType || 'oku',
        contractorId: payload.contractorId || '',
        text: payload.text || '',
        isDone: false,
        sortOrder: payload.sortOrder || Date.now(),
        dueDate: payload.dueDate || '',
        createdAt: now,
        updatedAt: now,
        updatedBy: getCurrentUserEmail_(),
        completedDate: ''
      };
      appendRow_(CONFIG.SHEETS.TODO_LIST, row);
      return row;
    });
  }

  function updateTodo(id, patch) {
    return withLock_(function() {
      return updateRowByKey_(CONFIG.SHEETS.TODO_LIST, 'todoId', id, patch, null);
    });
  }

  function deleteTodo(id) {
    return withLock_(function() {
      return deleteRowByKey_(CONFIG.SHEETS.TODO_LIST, 'todoId', id);
    });
  }

  /* -------- GanttOkuRows -------- */

  function listGanttOkuRows() {
    // Tolerate missing sheet (pre-migration deployments)
    try {
      const sh = getDataSS_().getSheetByName(CONFIG.SHEETS.GANTT_OKU_ROWS);
      if (!sh) return [];
    } catch (e) { return []; }
    const { rows } = readAll_(CONFIG.SHEETS.GANTT_OKU_ROWS);
    return rows.sort(function(a, b) {
      return (a['sortOrder'] || 0) - (b['sortOrder'] || 0);
    });
  }

  function createGanttOkuRow(payload) {
    return withLock_(function() {
      const sh = getSheetByName_(CONFIG.SHEETS.GANTT_OKU_ROWS);
      // Duplicate guard
      const data = sh.getDataRange().getValues();
      if (data.length > 1) {
        const headers = data[0];
        const idx = headers.indexOf('工番');
        if (idx !== -1) {
          for (let i = 1; i < data.length; i++) {
            if (String(data[i][idx]) === String(payload['工番'])) {
              return { duplicate: true };
            }
          }
        }
      }
      const id = uuid_();
      const now = nowISO_();
      const row = {
        rowId: id,
        工番: payload['工番'] || '',
        sortOrder: payload.sortOrder || Date.now(),
        createdAt: now,
        updatedAt: now,
        updatedBy: getCurrentUserEmail_()
      };
      appendRow_(CONFIG.SHEETS.GANTT_OKU_ROWS, row);
      return row;
    });
  }

  function updateGanttOkuRow(rowId, patch) {
    return withLock_(function() {
      return updateRowByKey_(CONFIG.SHEETS.GANTT_OKU_ROWS, 'rowId', rowId, patch, null);
    });
  }

  function deleteGanttOkuRow(rowId) {
    return withLock_(function() {
      return deleteRowByKey_(CONFIG.SHEETS.GANTT_OKU_ROWS, 'rowId', rowId);
    });
  }

  function reorderGanttOkuRows(orderedIds) {
    return withLock_(function() {
      const sh = getSheetByName_(CONFIG.SHEETS.GANTT_OKU_ROWS);
      const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
      const idIdx = headers.indexOf('rowId');
      const soIdx = headers.indexOf('sortOrder');
      const uaIdx = headers.indexOf('updatedAt');
      if (idIdx === -1 || soIdx === -1) return false;
      const data = sh.getDataRange().getValues();
      const now = nowISO_();
      for (let i = 1; i < data.length; i++) {
        const id = String(data[i][idIdx]);
        const pos = orderedIds.indexOf(id);
        if (pos !== -1) {
          sh.getRange(i + 1, soIdx + 1).setValue((pos + 1) * 10);
          if (uaIdx !== -1) sh.getRange(i + 1, uaIdx + 1).setValue(now);
        }
      }
      return true;
    });
  }

  /* -------- DailyMemo -------- */

  function getDailyMemo(date) {
    let sh;
    try {
      sh = getDataSS_().getSheetByName(CONFIG.SHEETS.DAILY_MEMO);
      if (!sh) return { date: date, text: '', preview: '' };
    } catch (e) { return { date: date, text: '', preview: '' }; }
    const data = sh.getDataRange().getValues();
    if (data.length < 2) return { date: date, text: '', preview: '' };
    const headers = data[0];
    const dIdx = headers.indexOf('date');
    const tIdx = headers.indexOf('text');
    const pIdx = headers.indexOf('preview');
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][dIdx]) === String(date)) {
        return {
          date: date,
          text: String(data[i][tIdx] || ''),
          preview: pIdx !== -1 ? String(data[i][pIdx] || '') : ''
        };
      }
    }
    return { date: date, text: '', preview: '' };
  }

  function listDailyMemos() {
    let sh;
    try {
      sh = getDataSS_().getSheetByName(CONFIG.SHEETS.DAILY_MEMO);
      if (!sh) return [];
    } catch (e) { return []; }
    const data = sh.getDataRange().getValues();
    if (data.length < 2) return [];
    const headers = data[0];
    const dIdx = headers.indexOf('date');
    const tIdx = headers.indexOf('text');
    const pIdx = headers.indexOf('preview');
    const uaIdx = headers.indexOf('updatedAt');
    const out = [];
    for (let i = 1; i < data.length; i++) {
      const text = String(data[i][tIdx] || '');
      const preview = pIdx !== -1 ? String(data[i][pIdx] || '') : '';
      const display = preview || text;
      if (!display.trim()) continue; // skip empty
      out.push({
        date: String(data[i][dIdx] || ''),
        preview: display.substring(0, 120).replace(/\s+/g, ' '),
        updatedAt: uaIdx !== -1 ? String(data[i][uaIdx] || '') : ''
      });
    }
    out.sort(function(a, b) { return String(b.date).localeCompare(String(a.date)); });
    return out;
  }

  function saveDailyMemo(date, text, preview) {
    return withLock_(function() {
      const sh = getSheetByName_(CONFIG.SHEETS.DAILY_MEMO);
      const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
      const dIdx = headers.indexOf('date');
      const tIdx = headers.indexOf('text');
      const pIdx = headers.indexOf('preview');
      const uaIdx = headers.indexOf('updatedAt');
      const ubIdx = headers.indexOf('updatedBy');
      const now = nowISO_();
      const email = getCurrentUserEmail_();
      const data = sh.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][dIdx]) === String(date)) {
          sh.getRange(i + 1, tIdx + 1).setValue(text);
          if (pIdx !== -1) sh.getRange(i + 1, pIdx + 1).setValue(preview || '');
          if (uaIdx !== -1) sh.getRange(i + 1, uaIdx + 1).setValue(now);
          if (ubIdx !== -1) sh.getRange(i + 1, ubIdx + 1).setValue(email);
          return { date: date, text: text, preview: preview || '', updatedAt: now };
        }
      }
      // append new
      const row = headers.map(function(h) {
        if (h === 'date') return date;
        if (h === 'text') return text;
        if (h === 'preview') return preview || '';
        if (h === 'updatedAt') return now;
        if (h === 'updatedBy') return email;
        return '';
      });
      sh.appendRow(row);
      return { date: date, text: text, preview: preview || '', updatedAt: now };
    });
  }

  /* -------- JobsCache -------- */

  function refreshJobsCache() {
    return withLock_(function() {
      const jobMasterId = getPropOrNull_(CONFIG.PROPS_KEYS.JOB_MASTER_SPREADSHEET_ID);
      if (!jobMasterId) {
        return { ok: false, message: 'JOB_MASTER_SPREADSHEET_ID 未設定' };
      }
      try {
        const src = SpreadsheetApp.openById(jobMasterId);
        const srcSheet = src.getSheetByName('工番マスタ') || src.getSheets()[0];
        const data = srcSheet.getDataRange().getValues();
        if (data.length < 2) return { ok: true, count: 0 };
        const headers = data[0];
        const now = nowISO_();

        const dstSheet = getSheetByName_(CONFIG.SHEETS.JOBS_CACHE);
        dstSheet.clear();
        dstSheet.getRange(1, 1, 1, CONFIG.HEADERS.JOBS_CACHE.length)
          .setValues([CONFIG.HEADERS.JOBS_CACHE]);

        const idxMap = {};
        ['工番', '受注先', '納入先', '納入先住所', '品名', '数量'].forEach(function(h) {
          idxMap[h] = headers.indexOf(h);
        });

        const outRows = [];
        for (let i = 1; i < data.length; i++) {
          const row = data[i];
          if (!row[idxMap['工番']]) continue;
          outRows.push([
            row[idxMap['工番']] || '',
            row[idxMap['受注先']] || '',
            row[idxMap['納入先']] || '',
            row[idxMap['納入先住所']] || '',
            row[idxMap['品名']] || '',
            row[idxMap['数量']] || '',
            now
          ]);
        }
        if (outRows.length > 0) {
          dstSheet.getRange(2, 1, outRows.length, CONFIG.HEADERS.JOBS_CACHE.length)
            .setValues(outRows);
        }
        return { ok: true, count: outRows.length };
      } catch (err) {
        return { ok: false, message: err.message };
      }
    });
  }

  return {
    listProcesses: listProcesses,
    listContractors: listContractors,
    listOkuSchedules: listOkuSchedules,
    listContractorSchedules: listContractorSchedules,
    listTodos: listTodos,
    listJobsCache: listJobsCache,
    searchJobs: searchJobs,
    listGanttOkuRows: listGanttOkuRows,
    createGanttOkuRow: createGanttOkuRow,
    updateGanttOkuRow: updateGanttOkuRow,
    deleteGanttOkuRow: deleteGanttOkuRow,
    reorderGanttOkuRows: reorderGanttOkuRows,
    getDailyMemo: getDailyMemo,
    saveDailyMemo: saveDailyMemo,
    listDailyMemos: listDailyMemos,
    createOkuSchedule: createOkuSchedule,
    updateOkuSchedule: updateOkuSchedule,
    deleteOkuSchedule: deleteOkuSchedule,
    createContractorSchedule: createContractorSchedule,
    updateContractorSchedule: updateContractorSchedule,
    deleteContractorSchedule: deleteContractorSchedule,
    createProcess: createProcess,
    updateProcess: updateProcess,
    updateContractor: updateContractor,
    createTodo: createTodo,
    updateTodo: updateTodo,
    deleteTodo: deleteTodo,
    refreshJobsCache: refreshJobsCache
  };
})();
