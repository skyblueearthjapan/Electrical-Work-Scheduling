/**
 * CalendarService.gs — Google Calendar 同期(Phase A: App → Calendar 片方向)
 *
 * 対象: OkuSchedule のみ
 * Advanced Calendar Service v3 使用(appsscript.json で有効化済み)
 *
 * 設計:
 * - DataService.createOkuSchedule / updateOkuSchedule / deleteOkuSchedule の
 *   末尾から非同期に呼ばれる(失敗してもシート保存は成功)
 * - 戻り値の eventId / etag / lastSyncedAt を OkuSchedule 行に直接書戻す
 *   (updatedAt は触らない — 楽観ロックの巻き戻りを防ぐため)
 */

/**
 * OkuSchedule 行を Calendar へ push
 * @param {Object} row    現在の OkuSchedule 行(scheduleId, 工番, 工程名, start, end, メモ, googleEventId, etag を含む)
 * @param {String} action 'create' | 'update' | 'delete'
 */
function pushOkuRowToCalendar(row, action) {
  const calendarId = getPropOrNull_(CONFIG.PROPS_KEYS.CALENDAR_ID);
  if (!calendarId) {
    Logger.log('[Calendar] CALENDAR_ID 未設定 — 同期スキップ');
    return;
  }
  if (!row || !row.scheduleId) {
    Logger.log('[Calendar] 無効な行 — スキップ');
    return;
  }

  try {
    if (action === 'delete') {
      if (!row.googleEventId) {
        Logger.log('[Calendar] delete: googleEventId 無し — スキップ ' + row.scheduleId);
        return;
      }
      Calendar.Events.remove(calendarId, row.googleEventId);
      // 削除後は eventId/etag をクリア
      writeBackSyncMeta_(row.scheduleId, { googleEventId: '', etag: '', lastSyncedAt: calNowISO_() });
      Logger.log('[Calendar] removed ' + row.scheduleId);
      return;
    }

    // create / update — まずイベントオブジェクトを構築
    const job = lookupJobByNo_(row['工番']);
    const event = {
      summary: buildEventTitle_(row['工番'], job),
      description: buildEventDescription_(job, row['工程名'], row['メモ']),
      start: { date: toDateStr_(row['start']) },
      end:   { date: addDayStr_(row['end'], 1) },  // all-day end は exclusive
      extendedProperties: {
        private: { appScheduleId: String(row.scheduleId) }
      }
    };

    let result;
    if (action === 'create' || !row.googleEventId) {
      result = Calendar.Events.insert(event, calendarId);
      Logger.log('[Calendar] inserted ' + row.scheduleId + ' -> ' + result.id);
    } else {
      result = Calendar.Events.patch(event, calendarId, row.googleEventId);
      Logger.log('[Calendar] patched ' + row.scheduleId);
    }

    writeBackSyncMeta_(row.scheduleId, {
      googleEventId: result.id || row.googleEventId || '',
      etag: result.etag || '',
      lastSyncedAt: calNowISO_()
    });
  } catch (e) {
    // Calendar 失敗はアプリ動作を止めない — ログのみ
    Logger.log('[Calendar] push failed (' + action + ' ' + row.scheduleId + '): ' + (e && e.message));
  }
}

/**
 * OkuSchedule 行に同期メタ(googleEventId / etag / lastSyncedAt)を直接書戻す。
 * updatedAt / updatedBy は変更しない(楽観ロックを壊さないため)。
 */
function writeBackSyncMeta_(scheduleId, meta) {
  const sh = getSheet_(CONFIG.SHEETS.OKU_SCHEDULE);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const idIdx = headers.indexOf('scheduleId');
  if (idIdx === -1) return;
  const data = sh.getRange(2, idIdx + 1, Math.max(0, sh.getLastRow() - 1), 1).getValues();
  let rowIdx = -1;
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0]) === String(scheduleId)) { rowIdx = i + 2; break; }
  }
  if (rowIdx === -1) return;
  Object.keys(meta).forEach(function(k) {
    const c = headers.indexOf(k);
    if (c !== -1) sh.getRange(rowIdx, c + 1).setValue(meta[k]);
  });
}

/**
 * JobsCache から 工番一致の Job を取得
 */
function lookupJobByNo_(jobNo) {
  if (!jobNo) return null;
  try {
    const sh = getSheet_(CONFIG.SHEETS.JOBS_CACHE);
    const data = sh.getDataRange().getValues();
    if (data.length < 2) return null;
    const headers = data[0];
    const jnIdx = headers.indexOf('工番');
    if (jnIdx === -1) return null;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][jnIdx]) === String(jobNo)) {
        const obj = {};
        headers.forEach(function(h, k) { obj[h] = data[i][k]; });
        return obj;
      }
    }
  } catch (e) {
    Logger.log('[Calendar] lookupJobByNo_ failed: ' + e.message);
  }
  return null;
}

/* -------- date helpers (Calendar 用ローカル) -------- */

function calNowISO_() {
  return Utilities.formatDate(new Date(), 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ss");
}

function toDateStr_(v) {
  if (!v) return '';
  if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy-MM-dd');
  const s = String(v);
  return s.length >= 10 ? s.substring(0, 10) : s;
}

function addDayStr_(v, days) {
  const s = toDateStr_(v);
  if (!s) return '';
  const parts = s.split('-');
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  d.setDate(d.getDate() + days);
  return Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd');
}

/* -------- title / description builders -------- */

/**
 * イベントタイトル: "奥:工事 {工番} {納入先} {品名}"
 *   例: 奥:工事 LW25128 大京 MTlock-1500
 *   納入先・品名が無い場合は該当部分を省略する。
 */
function buildEventTitle_(工番, job) {
  const parts = ['奥:工事'];
  if (工番) parts.push(String(工番));
  if (job && job['納入先']) parts.push(String(job['納入先']));
  if (job && job['品名'])   parts.push(String(job['品名']));
  return parts.join(' ');
}

function buildEventDescription_(job, 工程名, memo) {
  const parts = [];
  if (工程名) parts.push('工程: ' + 工程名);
  if (job) {
    if (job['納入先']) parts.push('納入先: ' + job['納入先']);
    if (job['品名']) parts.push('品名: ' + job['品名']);
  }
  if (memo) parts.push('メモ: ' + memo);
  return parts.join('\n');
}

/* -------- Phase B プレースホルダ(現状未実装) -------- */

function pullFromCalendar() {
  // Phase B: Calendar → App 双方向同期はまだ未実装
  Logger.log('[STUB] pullFromCalendar');
}
