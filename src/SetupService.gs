/**
 * SetupService.gs — 初期セットアップ
 *
 * 初回起動時に GAS エディタから順番に実行する:
 * 1) setupScriptProperties()  — スクリプトプロパティ設定
 * 2) setupInitialSheets()     — シート7枚作成
 * 3) setupInitialMasters()    — 電気工程13件 + 業者6社 投入
 * 4) setupPermissionsSelf()   — 自分をeditorに登録
 * 5) installCalendarSyncTrigger() — 1分トリガー登録
 */

/**
 * Script Propertiesに既知のIDを登録。
 * 値は別途 setValue で設定してから実行するか、
 * エディタから手動で「プロジェクトの設定 → スクリプトプロパティ」で登録。
 *
 * 最低限必要:
 * - DATA_SPREADSHEET_ID         : 本アプリのデータSS ID(新規作成済み)
 * - JOB_MASTER_SPREADSHEET_ID   : 工番マスタSS ID
 * - CALENDAR_ID                 : electrical-01@lineworks-local.info
 *
 * オプション:
 * - BRIDGE_GAS_URL              : 中継GAS WebApp URL(Phase 4)
 * - BRIDGE_GAS_TOKEN            : 中継GAS 共有トークン(Phase 4)
 */
function setupScriptProperties() {
  const props = PropertiesService.getScriptProperties();
  const existing = props.getProperties();
  Logger.log('既存プロパティ:');
  Object.keys(existing).forEach(function(k) {
    Logger.log('  ' + k + ' = ' + existing[k]);
  });

  Logger.log('---');
  Logger.log('必須プロパティ未設定の場合は、GASエディタの「プロジェクトの設定 → スクリプトプロパティ」で以下を登録してください:');
  const required = [
    CONFIG.PROPS_KEYS.DATA_SPREADSHEET_ID,
    CONFIG.PROPS_KEYS.JOB_MASTER_SPREADSHEET_ID,
    CONFIG.PROPS_KEYS.CALENDAR_ID
  ];
  required.forEach(function(k) {
    const v = props.getProperty(k);
    Logger.log('  ' + k + ': ' + (v ? '✓ ' + v : '✗ 未設定'));
  });
}

/**
 * 新規データSSを作成してIDをログ出力。
 * スクリプトプロパティにはユーザーが手動で登録する想定。
 */
function createDataSpreadsheet() {
  const ss = SpreadsheetApp.create('電気工事スケジューリング_Data_' +
    Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd_HHmmss'));
  const id = ss.getId();
  const url = ss.getUrl();
  Logger.log('新規SS作成:');
  Logger.log('  ID: ' + id);
  Logger.log('  URL: ' + url);
  Logger.log('→ スクリプトプロパティ DATA_SPREADSHEET_ID に上記IDを登録してください。');
  return { id: id, url: url };
}

/**
 * 必要シートを全て作成。ヘッダ行を設定。
 */
function setupInitialSheets() {
  const ss = getDataSS_();

  Object.keys(CONFIG.SHEETS).forEach(function(k) {
    const sheetName = CONFIG.SHEETS[k];
    let sh = ss.getSheetByName(sheetName);
    if (!sh) {
      sh = ss.insertSheet(sheetName);
      Logger.log('作成: ' + sheetName);
    }
    const headers = CONFIG.HEADERS[k];
    if (headers && headers.length > 0) {
      // ヘッダが空 or 不一致なら書き換え
      const range = sh.getRange(1, 1, 1, headers.length);
      const current = range.getValues()[0];
      if (current.join('|') !== headers.join('|')) {
        range.setValues([headers]);
        sh.getRange(1, 1, 1, headers.length)
          .setFontWeight('bold')
          .setBackground('#1F2937')
          .setFontColor('#F5F5F5');
        sh.setFrozenRows(1);
      }
    }
  });

  // デフォルトシートを削除(あれば)
  const defaultSheet = ss.getSheetByName('シート1') || ss.getSheetByName('Sheet1');
  if (defaultSheet && ss.getSheets().length > 1) {
    try { ss.deleteSheet(defaultSheet); } catch (e) {}
  }

  // SchemaVersion に初期レコード
  const svSheet = ss.getSheetByName(CONFIG.SHEETS.SCHEMA_VERSION);
  if (svSheet && svSheet.getLastRow() < 2) {
    svSheet.appendRow([CONFIG.SCHEMA_VERSION,
      Utilities.formatDate(new Date(), 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ss"),
      'initial setup']);
  }

  Logger.log('✓ シート作成完了');
}

/**
 * 電気工程マスタ13件 + 業者マスタ6社を投入。
 * 既に存在する場合はスキップ。
 */
function setupInitialMasters() {
  // 電気工程
  const processSheet = getSheet_(CONFIG.SHEETS.ELECTRICAL_PROCESS_MASTER);
  if (processSheet.getLastRow() < 2) {
    const rows = CONFIG.INITIAL_PROCESSES.map(function(name, i) {
      return [
        'EP' + String(i + 1).padStart(3, '0'),   // processId
        name,                                      // 工程名
        'range',                                   // 種別
        (i + 1) * 10,                              // 表示順
        CONFIG.COLOR_PALETTE[i % CONFIG.COLOR_PALETTE.length], // 色
        true,                                      // 有効
        ''                                         // 備考
      ];
    });
    processSheet.getRange(2, 1, rows.length, CONFIG.HEADERS.ELECTRICAL_PROCESS_MASTER.length)
      .setValues(rows);
    Logger.log('✓ 電気工程マスタ ' + rows.length + '件 投入');
  } else {
    Logger.log('電気工程マスタ: 既に存在(スキップ)');
  }

  // 業者マスタ
  const contractorSheet = getSheet_(CONFIG.SHEETS.CONTRACTORS);
  if (contractorSheet.getLastRow() < 2) {
    const rows = CONFIG.INITIAL_CONTRACTORS.map(function(c, i) {
      return [
        'C' + String(i + 1).padStart(3, '0'),  // contractorId
        c.name,                                 // 業者名
        '',                                     // 担当者
        '',                                     // 電話番号
        '',                                     // メール
        c.color,                                // 識別色
        (i + 1) * 10,                           // 表示順
        true,                                   // 有効
        ''                                      // 備考
      ];
    });
    contractorSheet.getRange(2, 1, rows.length, CONFIG.HEADERS.CONTRACTORS.length)
      .setValues(rows);
    Logger.log('✓ 業者マスタ ' + rows.length + '件 投入');
  } else {
    Logger.log('業者マスタ: 既に存在(スキップ)');
  }
}

/**
 * 実行ユーザー自身をeditorに登録。
 */
function setupPermissionsSelf() {
  const email = getCurrentUserEmail_();
  if (!email) {
    Logger.log('✗ 実行ユーザーのメールが取得できません');
    return;
  }
  const sh = getSheet_(CONFIG.SHEETS.PERMISSIONS);
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const emailIdx = headers.indexOf('email');
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][emailIdx] || '').toLowerCase() === email) {
      Logger.log('既に登録済み: ' + email);
      return;
    }
  }
  sh.appendRow([
    email,
    'editor',
    true,
    Utilities.formatDate(new Date(), 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ss")
  ]);
  Logger.log('✓ 自分をeditor登録: ' + email);
}

/**
 * 全セットアップを一括実行(初回のみ)。
 */
function setupAll() {
  setupScriptProperties();
  setupInitialSheets();
  setupInitialMasters();
  setupPermissionsSelf();

  // 工番マスタ同期(任意)
  try {
    const r = DataService.refreshJobsCache();
    Logger.log('JobsCache: ' + JSON.stringify(r));
  } catch (e) {
    Logger.log('JobsCache refresh skipped: ' + e.message);
  }

  Logger.log('');
  Logger.log('=== セットアップ完了 ===');
  Logger.log('次のステップ: WebApp デプロイ → URLを共有');
}

/**
 * 業者マスタの 短縮名 と 坂野電気の識別色 を一括反映するマイグレーション。
 * 1回だけ実行すればOK。
 */
function migrateContractorShortName() {
  const sh = getSheet_(CONFIG.SHEETS.CONTRACTORS);
  const data = sh.getDataRange().getValues();
  if (data.length < 2) {
    Logger.log('業者マスタが空です');
    return;
  }
  const headers = data[0];
  const idxName  = headers.indexOf('業者名');
  const idxShort = headers.indexOf('短縮名');
  const idxColor = headers.indexOf('識別色');
  if (idxShort === -1) {
    Logger.log('✗ 短縮名 列がありません。先に setupInitialSheets() を実行してください。');
    return;
  }

  // 業者名 → 推奨短縮名 のマップ
  const shortMap = {
    'H・Y・Tシステム':            'HYT',
    '有限会社サンスイ':           'サンスイ',
    '坂野電気工業所':             '坂野',
    '株式会社内山電機製作所':     '内山',
    '株式会社桜井電装':           '桜井',
    'RCエンジニアリング株式会社': 'RC'
  };

  let updated = 0;
  for (let i = 1; i < data.length; i++) {
    const name = String(data[i][idxName] || '');
    // 短縮名 セット(空の場合のみ)
    if (!data[i][idxShort] && shortMap[name]) {
      sh.getRange(i + 1, idxShort + 1).setValue(shortMap[name]);
      updated++;
    }
    // 坂野電気工業所 の識別色を黄色に変更
    if (name === '坂野電気工業所' && idxColor !== -1) {
      sh.getRange(i + 1, idxColor + 1).setValue('#FACC15');
      Logger.log('✓ 坂野電気工業所 の識別色を #FACC15(黄色)に更新');
    }
  }
  Logger.log('✓ 短縮名 を ' + updated + ' 件設定');
  Logger.log('完了。WebApp を更新ボタンで再読込してください。');
}

/**
 * Calendar同期トリガー設置(Phase 5)
 */
function installCalendarSyncTrigger() {
  // 既存トリガーを削除
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(t) {
    if (t.getHandlerFunction() === 'pullFromCalendar') {
      ScriptApp.deleteTrigger(t);
    }
  });
  // 1分ごと
  ScriptApp.newTrigger('pullFromCalendar')
    .timeBased()
    .everyMinutes(1)
    .create();
  Logger.log('✓ Calendar 同期トリガー設置');
}
