/**
 * AIService.gs — Google Gemini API による
 * 自由文 → スケジュール構造化抽出
 *
 * 設計:
 * - API キーは Script Properties GEMINI_API_KEY
 * - generationConfig.responseSchema (OpenAPI subset) で構造を強制
 * - 入力文(複数行可) → items[] として複数スケジュール抽出
 * - 業者は事前指定(プロンプトには含めるが抽出させない)
 * - レート制限は CacheService で 30 req/min/user
 * - リトライ: 429/5xx に対して指数バックオフ最大4回
 *
 * 切替: CONFIG.AI.PROVIDER = 'gemini' | 'openai' で将来的に切替可能
 */

const AIService = (function() {

  function getGeminiKey_() {
    const k = PropertiesService.getScriptProperties().getProperty(CONFIG.PROPS_KEYS.GEMINI_API_KEY);
    if (!k) {
      const e = new Error('GEMINI_API_KEY が未設定です。GAS のスクリプトプロパティに登録してください。');
      e.code = 503;
      throw e;
    }
    return k;
  }

  /**
   * 1ユーザあたりのレート制限(分間)。
   * 制限を超えたら例外。
   */
  function checkRateLimit_(email) {
    const cache = CacheService.getUserCache();
    const key = 'ai_rl_' + (email || 'anon');
    const raw = cache.get(key);
    const arr = raw ? JSON.parse(raw) : [];
    const now = Date.now();
    const cutoff = now - 60 * 1000;
    const recent = arr.filter(function(t) { return t > cutoff; });
    if (recent.length >= CONFIG.AI.RATE_LIMIT_PER_MIN) {
      const e = new Error('レート制限: 1分間に ' + CONFIG.AI.RATE_LIMIT_PER_MIN + ' 回までです。少し待ってから再試行してください。');
      e.code = 429;
      throw e;
    }
    recent.push(now);
    cache.put(key, JSON.stringify(recent), 90);
  }

  /**
   * Gemini generateContent を呼び出し、リトライしつつパース済みオブジェクトを返す。
   */
  function callGemini_(payload) {
    const key = getGeminiKey_();
    const model = CONFIG.AI.MODEL || 'gemini-2.5-flash';
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
                encodeURIComponent(model) + ':generateContent';
    let lastErr = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      let res;
      try {
        res = UrlFetchApp.fetch(url, {
          method: 'post',
          contentType: 'application/json',
          headers: { 'x-goog-api-key': key },
          payload: JSON.stringify(payload),
          muteHttpExceptions: true
        });
      } catch (err) {
        lastErr = err;
        Utilities.sleep(500 * Math.pow(2, attempt));
        continue;
      }
      const code = res.getResponseCode();
      const text = res.getContentText();
      if (code === 200) {
        try { return JSON.parse(text); }
        catch (e) { throw new Error('Gemini 応答が JSON ではありません: ' + text.substring(0, 200)); }
      }
      // リトライ可能なエラー
      if (code === 429 || code >= 500) {
        // quota exceeded など retryable と区別が難しいので通常リトライ
        lastErr = new Error('Gemini ' + code + ': ' + text.substring(0, 300));
        Utilities.sleep(800 * Math.pow(2, attempt) + Math.floor(Math.random() * 250));
        continue;
      }
      // 4xx (リトライ不可)
      throw new Error('Gemini API ' + code + ': ' + text.substring(0, 400));
    }
    throw lastErr || new Error('Gemini API: リトライ上限到達');
  }

  /**
   * Gemini responseSchema フォーマット(OpenAPI 3.0 subset, UPPERCASE types).
   */
  function buildSchema_() {
    return {
      type: 'OBJECT',
      properties: {
        items: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              '工番':           { type: 'STRING', nullable: true },
              '工程名':         { type: 'STRING', nullable: true },
              start:            { type: 'STRING', nullable: true, description: 'YYYY-MM-DD' },
              end:              { type: 'STRING', nullable: true, description: 'YYYY-MM-DD' },
              'メモ':           { type: 'STRING' },
              confidence:       { type: 'NUMBER' },
              ambiguousFields:  { type: 'ARRAY', items: { type: 'STRING' } }
            },
            required: ['工番','工程名','start','end','メモ','confidence','ambiguousFields']
          }
        },
        globalNotes: { type: 'STRING' }
      },
      required: ['items', 'globalNotes']
    };
  }

  function buildSystemPrompt_(today, processNames, scopeLabel) {
    return [
      'あなたは電気工事会社のスケジュール抽出アシスタントです。',
      '日本語の自由文から複数のスケジュールを抽出し、構造化 JSON で出力してください。',
      '',
      '# 基準日',
      '今日: ' + today + '(以下、相対日付の解決基準)',
      '',
      '# 出力対象スコープ',
      scopeLabel,
      '',
      '# 工程マスタ(これに最も近い名前に正規化、未該当なら最も近い候補を採用)',
      processNames.join(', '),
      '',
      '# 工番フォーマット',
      '「LW」+ 5桁数字(例: LW25056)。半角に正規化する。「lw25056」「LW 25056」等も可。',
      '',
      '# 抽出ルール',
      '- 入力文には複数のスケジュールが含まれる可能性がある。改行や句読点で区切られた塊ごとに 1 件として items 配列に格納する。',
      '- 1件ずつ独立して解析する。',
      '- 日付:',
      '  - "M/D" → 当年(過去なら翌年)',
      '  - "M/D〜M/D" / "M/D から M/D" → start, end',
      '  - "明日"=today+1, "明後日"=today+2, "今日"=today',
      '  - "来週月曜" → 翌週月曜(週は月曜始まり)',
      '  - "今週末" → 直近土曜',
      '  - "N日間" → start + (N-1)日 = end',
      '  - 単一日のみ → start = end',
      '  - 範囲が逆転していたら入れ替えて メモ に注記',
      '- 工程名:',
      '  - 「配線工事」「配線」→「電気工事」',
      '  - 「デバッグ」→「デバック」',
      '  - 「タッチパネル」→「タッチパネル設計」',
      '  - 部分一致 → 最長一致を採用',
      '  - 該当不明 → 入力値そのまま、ambiguousFields に "工程名" を追加',
      '- 工番不明 → null、ambiguousFields に "工番" を追加',
      '- 必ず日付は YYYY-MM-DD 形式',
      '- confidence は 0.0〜1.0:',
      '  - 1.0: 全フィールドが明示的かつマスタ完全一致',
      '  - 0.8〜0.9: 軽微な正規化のみ',
      '  - 0.5〜0.7: 相対日付解決 / あいまい一致を含む',
      '  - 0.3〜0.5: 一部欠損あり',
      '  - <0.3: 重大な欠損',
      '- メモ には注記・解釈根拠を 80 文字以内で日本語で書く',
      ''
    ].join('\n');
  }

  /**
   * 公開関数: 自由文からスケジュールを抽出
   * @param {string} text     ユーザー入力文(複数行可)
   * @param {string} scope    'oku' | 'contractor'
   * @param {string|null} contractorName  scope=contractor の場合の業者名
   * @return {object} { items: [...], globalNotes: string }
   */
  function parseSchedules(text, scope, contractorName) {
    const email = (Session.getActiveUser().getEmail() || '').toLowerCase();
    checkRateLimit_(email);

    if (!text || !String(text).trim()) {
      throw new Error('入力文が空です');
    }
    text = String(text).slice(0, CONFIG.AI.INPUT_MAX_CHARS);

    const today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
    const processes = DataService.listProcesses().map(function(p) { return p['工程名']; });

    const scopeLabel = (scope === 'contractor' && contractorName)
      ? '業者「' + contractorName + '」のスケジュール(業者は指定済みのため抽出しないこと)'
      : '奥氏(自社)のスケジュール';

    const systemText = buildSystemPrompt_(today, processes, scopeLabel);

    const payload = {
      systemInstruction: {
        parts: [{ text: systemText }]
      },
      contents: [
        { role: 'user', parts: [{ text: text }] }
      ],
      generationConfig: {
        temperature: CONFIG.AI.TEMPERATURE,
        maxOutputTokens: CONFIG.AI.MAX_TOKENS,
        responseMimeType: 'application/json',
        responseSchema: buildSchema_()
      }
    };

    const resp = callGemini_(payload);

    // Gemini 応答: candidates[0].content.parts[0].text に JSON 文字列
    const candidate = resp && resp.candidates && resp.candidates[0];
    if (!candidate) {
      // promptFeedback ブロックされている可能性
      const fb = resp && resp.promptFeedback;
      const reason = fb && fb.blockReason ? '(' + fb.blockReason + ')' : '';
      throw new Error('Gemini 応答に candidates がありません ' + reason);
    }
    const parts = candidate.content && candidate.content.parts;
    if (!parts || !parts.length) throw new Error('Gemini 応答に parts がありません');
    const content = parts[0].text || '';
    if (!content) throw new Error('Gemini 応答に text がありません');

    let parsed;
    try { parsed = JSON.parse(content); }
    catch (e) { throw new Error('構造化JSON のパースに失敗: ' + content.substring(0, 200)); }

    if (!parsed || !Array.isArray(parsed.items)) {
      throw new Error('items 配列が含まれていません');
    }

    if (resp.usageMetadata) parsed._usage = resp.usageMetadata;
    parsed._model = CONFIG.AI.MODEL;
    parsed._provider = 'gemini';
    parsed._scope = scope;
    parsed._contractorName = contractorName || '';
    return parsed;
  }

  return {
    parseSchedules: parseSchedules
  };
})();
