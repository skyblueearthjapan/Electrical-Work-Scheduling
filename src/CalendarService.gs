/**
 * CalendarService.gs — Google Calendar 双方向同期(Phase 5)
 *
 * Advanced Calendar Service v3 使用(appsscript.json で有効化済み)
 * パターン: App↔Cal の etag楽観ロック + syncTokenインクリメンタルpull
 *
 * 注意: MVP版ではスタブ実装。
 * 完全実装は Phase 5 で REQUIREMENTS §9 に従って拡張。
 */

/**
 * OkuSchedule 行を Calendar へ push(Phase 5)
 */
function pushRowToCalendar(scheduleId, action) {
  // TODO: Phase 5 実装
  // 1. OkuSchedule から該当行取得
  // 2. action=create → Calendar.Events.insert
  //    action=update → Calendar.Events.patch (If-Match: etag)
  //    action=delete → Calendar.Events.remove
  // 3. 戻り値の eventId/etag を Sheet に書戻し
  Logger.log('[STUB] pushRowToCalendar ' + scheduleId + ' ' + action);
}

/**
 * Calendar からの増分pull(1分トリガーで呼ばれる)
 */
function pullFromCalendar() {
  // TODO: Phase 5 実装
  // 1. Script Propertiesから calSyncToken 取得
  // 2. Calendar.Events.list(calendarId, { syncToken })
  // 3. 410 → フル同期フォールバック
  // 4. 各 event → applyEventToSheet
  // 5. nextSyncToken 保存
  Logger.log('[STUB] pullFromCalendar');
}

/**
 * Calendar event → OkuSchedule 行に反映
 */
function applyEventToSheet_(ev) {
  // TODO: Phase 5 実装
  // extendedProperties.private.appRowKey から scheduleId 取得
  // 競合検知: sheet.updatedAt > lastSyncedAt かつ ev.updated > lastSyncedAt なら ConflictLog
  Logger.log('[STUB] applyEventToSheet_');
}

/**
 * イベントタイトル生成
 */
function buildEventTitle_(工番, 工程名) {
  return String(工番 || '') + ' ' + String(工程名 || '');
}

function buildEventDescription_(job, memo) {
  const parts = [];
  if (job) {
    if (job['納入先']) parts.push('納入先: ' + job['納入先']);
    if (job['品名']) parts.push('製品: ' + job['品名']);
  }
  if (memo) parts.push('メモ: ' + memo);
  return parts.join('\n');
}
