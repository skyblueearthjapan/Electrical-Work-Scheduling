# 電気工事スケジューリングアプリ 要件定義書

**バージョン:** v1.0
**作成日:** 2026-04-07
**作成:** Claude (オーケストレーション調査ベース)
**ステータス:** ユーザー承認待ち

---

## 目次

1. [プロジェクト概要](#1-プロジェクト概要)
2. [技術スタック](#2-技術スタック)
3. [システム構成図](#3-システム構成図)
4. [画面構成](#4-画面構成)
5. [ガント管理タブ詳細](#5-ガント管理タブ詳細)
6. [カレンダータブ詳細](#6-カレンダータブ詳細fullcalendar-v6)
7. [データモデル](#7-データモデル)
8. [中継GAS仕様](#8-中継gas仕様新規作成)
9. [Google Calendar 連携](#9-google-calendar-連携奥氏のみ)
10. [保存方式](#10-保存方式guest-check-in-app-パターン)
11. [業者色の初期自動割当](#11-業者色の初期自動割当提案)
12. [実装フェーズ](#12-実装フェーズ)
13. [調査で判明した重要事項](#13-調査で判明した重要事項)
14. [未確定の軽微事項](#14-未確定の軽微事項実装中に確認)
15. [参考ドキュメント](#15-参考ドキュメント)

---

## 1. プロジェクト概要

| 項目 | 内容 |
|---|---|
| **名称** | 電気工事スケジューリングアプリ |
| **目的** | 電気設計(奥氏)と外注電気業者6社のスケジュール統合管理 |
| **主利用者** | 奥氏(入力主体)、今泉様(閲覧・入力) |
| **リポジトリ** | `skyblueearthjapan/Electrical-Work-Scheduling`(現状空) |
| **GASプロジェクト** | `1HdVLArk51QlFxm8YxHtyBtR8jSOMraTUhXDFfaJiPtLIr4K7Y-TEdvrR`(現状空) |
| **スプレッドシート** | 新規作成予定(ID未定) |
| **連携Calendar** | `electrical-01@lineworks-local.info`(双方向) |
| **デザインコンセプト** | ダークテーマ × 渋くかっこよく × 高視認性 |

---

## 2. 技術スタック

| レイヤ | 採用技術 | 備考 |
|---|---|---|
| フロントエンド | Vanilla JS + Tailwind CDN | フレームワーク不使用 |
| 月カレンダー | **FullCalendar v6.1.20** (MIT, CDN) | `--fc-*` CSS変数でダーク化 |
| ガントチャート | **生産工程表からスクラッチコード流用** | ライブラリ不採用 |
| バックエンド | Google Apps Script (V8) | |
| DB | Google スプレッドシート | |
| デプロイ | GAS WebApp | `executeAs: USER_DEPLOYING`, `access: DOMAIN` |
| ソース管理 | GitHub + clasp | |
| タブ方式 | Guest-Check-in-Appの全ページプリロード方式 | タブ切替は display toggle のみ |
| 保存方式 | Guest-Check-in-Appの楽観的UI + 5秒デバウンス | + beforeunload保護 |
| Calendar API | Advanced Calendar Service v3 | `syncToken`対応 |
| 生産工程表接続 | **中継GAS新設**(BFF/Facadeパターン) | 本番無改修 |

---

## 3. システム構成図

```
┌─────────────────────────────────────────────┐
│  電気工事スケジューリング GAS WebApp           │
│  - タブ: ガント / 奥氏カレンダー / 業者A-F    │
│  - 楽観的UI + 5秒デバウンス保存                │
└────┬──────────────┬────────────┬────────────┘
     │              │            │
     ▼              ▼            ▼
 新規SS        electrical-01@   中継GAS (新規)
 (本アプリの   Google Calendar     │
  正データ)    双方向同期           ▼
                              生産工程表SS
                              (読取のみ)
```

---

## 4. 画面構成

### 4.1 全体レイアウト

- **ダークテーマ固定**(渋くかっこよく × 高視認性)
- タブバー最上部(sticky)
- 初回ロード時に**全タブ一括プリロード**
- タブ切替は display toggle のみ(再フェッチなし)
- 右上固定: 保存ステータス `✓ 保存済み` / `● 未保存` / `⟳ 保存中...` / `✕ エラー`

### 4.2 タブ一覧

| # | タブ名 | 主コンテンツ |
|---|---|---|
| 1 | **ガント管理** | 奥氏ガント(上) + 業者ガント(下) |
| 2 | **奥氏カレンダー** | FullCalendar月表示 + 作業状況メモ |
| 3 | **H・Y・Tシステム** (C001) | FullCalendar月 + 依頼状況メモ + 連絡先 |
| 4 | **有限会社サンスイ** (C002) | 同上 |
| 5 | **坂野電気工業所** (C003) | 同上 |
| 6 | **株式会社内山電機製作所** (C004) | 同上 |
| 7 | **株式会社桜井電装** (C005) | 同上 |
| 8 | **RCエンジニアリング株式会社** (C006) | 同上 |

---

## 5. ガント管理タブ詳細

### 5.1 共通仕様

- セル幅 **32px**(生産工程表と同じ)
- デフォルト表示 **90日**、切替可能(30/60/90/180日)
- 横スクロール: **上下完全同期**(どちらを動かしても両方動く)
- 日付ヘッダ: 上下で**独立に描画**
- 本日ライン(縦の強調線)

### 5.2 奥氏エリア(上段)

- 行 = 工番1つ(左端に「工番追加」ボタン + 検索窓)
- **工番検索**: 工番マスタ(`1iu5HoaknlW1...`)から検索ドロップダウン
- 行の右端: 工番情報 `LW25056 / ㈱○○ / 製品名`(詳細はホバーで展開)
- **ゴースト表示**: 生産工程表の isWeekly=TRUE 5工程を半透明(opacity 0.30)で背景描画
  - クリックで**詳細ポップアップ**表示(生産工程表の情報・担当者・status)
- **入力モーダル**(ドラッグ後に開く):
  - 工番: 自動(行から継承、非表示)
  - 担当者: 自動(奥氏固定、非表示)
  - 工程: プルダウン(電気工程マスタ)+ 自由記述トグル
  - 自由記述時: マスタ登録 / この予定のみ を選択
  - 色: 工程自動 or ランダム自動 + 変更可
  - 開始/終了日: ドラッグ結果を初期値
  - メモ

### 5.3 業者エリア(下段)

- 行 = 業者1社(6社固定、順序はタブと同じ)
- 同業者に**同日で重複**時 → 自動で2行・3行にレーン分割(生産工程表のロジック流用)
- **入力モーダル**:
  - 工番: **選択必須**(検索プルダウン、工番マスタから)
  - 担当者: 自動(行から業者取得)
  - 工程: プルダウン + 自由記述
  - 色: 工程色 + 業者色縁取り
  - メモ
- 奥氏エリアとは**独立**(工番追加も連動しない)

### 5.4 配色ロジック(デュアルエンコーディング)

| 要素 | 意味 | 決定ロジック |
|---|---|---|
| **塗り(背景)** | 作業内容 | カスタム色 > 工程色 > デフォルト |
| **縁取り(2px)** | 担当業者 | 業者色(業者紐付けあり時のみ) |
| **左端アクセント(3px)** | 重要度 | isWeekly相当は黄色アクセント |

これにより1つのバーで「**作業内容 + 担当業者 + 重要度**」を同時表示可能。

---

## 6. カレンダータブ詳細(FullCalendar v6)

### 6.1 共通

- **月表示のみ**(週/日非搭載)
- ロケール: 日本語
- ダークテーマ(`--fc-*` CSS変数でカスタム、Notion風)
- `selectable: true` でドラッグ複数日選択 → モーダル
- `eventClick` で既存イベント編集
- ガントとデータソース共有 + `refetchEvents()` で双方向反映
- **CDN**: `https://cdn.jsdelivr.net/npm/fullcalendar@6.1.20/index.global.min.js`

### 6.2 奥氏カレンダー

- 上部: 月切替ナビ
- 中央: FullCalendar
- 下部: **作業状況メモ**(箇条書き、追加/編集/削除/完了チェック、折りたたみなし)
- 配色: デュアルエンコーディング適用

### 6.3 業者カレンダー(各サブタブ)

- 上部: 業者情報(業者名・担当者・電話番号・メール)
- 中央: FullCalendar(該当業者の予定のみ表示)
- 下部: **依頼状況メモ**(箇条書き、業者別)
- 配色: 業者色ベース + 工程色アクセント

---

## 7. データモデル

### 7.1 新規スプレッドシート シート構成

#### `OkuSchedule`(奥氏ガント正データ)

```
scheduleId(UUID) | 工番(LW文字列) | processId | 工程名 | start | end
| 色(HEX) | メモ | googleEventId | etag | lastSyncedAt
| updatedAt | updatedBy
```

#### `ContractorSchedule`(業者ガント正データ)

```
scheduleId(UUID) | contractorId | 工番 | processId | 工程名
| start | end | 色(HEX) | メモ | updatedAt | updatedBy
```

#### `ElectricalProcessMaster`(電気工事独自工程)

```
processId(自動) | 工程名 | 種別(デフォルトrange) | 表示順(自動)
| 色(自動HEX) | 有効(デフォルトTRUE) | 備考
```

**初期データ:**
1. ハード設計
2. ハード承認図提出
3. ハード承認図返却期間
4. ソフト設計
5. タッチパネル設計
6. 電気工事
7. デバック
8. 試運転
9. 動作確認
10. 立会
11. 出荷
12. 現地試運転
13. 現地立会

#### `Contractors`(業者マスタ)

```
contractorId | 業者名 | 担当者 | 電話番号 | メール | 識別色(HEX) | 有効 | 備考
```

初期データ: 6社(下記セクション11参照)

#### `TodoList`(メモ・ToDo)

```
todoId | scope(oku/C001-C006) | text | isDone | sortOrder
| createdAt | updatedAt | updatedBy
```

#### `SyncState`(Calendar同期状態)

```
key | value
```

保持項目: `calSyncToken`, `lastFullSyncAt`, `channelExpiration` など

#### `ConflictLog`(競合ログ)

```
logId | occurredAt | scheduleId | sheetVersion | calendarVersion | resolution
```

#### `Permissions`(生産工程表と同パターン)

```
email | role(editor/viewer) | isActive
```

### 7.2 外部参照(読取のみ)

| 参照先 | シート | 用途 | 接続方法 |
|---|---|---|---|
| 工番マスタ `1iu5HoaknlW1...` | 工番マスタ | 工番追加時の検索候補 | 直接 Sheets API |
| 生産工程表 `1tBwMS...` | Schedule + Jobs + ProcessMaster | ゴースト表示 | **中継GAS経由** |

---

## 8. 中継GAS仕様(新規作成)

### 8.1 役割

- 本番の生産工程表アプリを**無改修**のまま、新アプリに読取APIを提供
- 認証境界の分離
- キャッシュによる負荷軽減

### 8.2 公開エンドポイント

```javascript
// WebApp doGet(e) で以下のaction対応:

getGhostSchedules({
  工番List: ['LW25056', 'LW25069', ...],  // 対象工番
  startDate: '2026-04-01',
  endDate: '2026-06-30'
})
→ [
  {
    工番: 'LW25056',
    processId: 'P065',
    工程名: '電気工事',
    start: '2026-04-10',
    end: '2026-04-15',
    色: '#1F4E79',
    status: '予定',
    担当者: '片岡 暢'
  }, ...
]

getJobDetail(工番: 'LW25056')
→ {
    工番, 顧客名, 設備/製品名, 納入先, 住所,
    出荷予定日, 出図予定日, 状態, 重要メモ
  }
```

### 8.3 キャッシュ戦略

- `CacheService.getScriptCache()` で 5分キャッシュ
- ユーザーが「更新」ボタン押下で強制リフレッシュ

---

## 9. Google Calendar 連携(奥氏のみ)

### 9.1 基本方針

- **API**: Advanced Calendar Service v3
- **対象**: `electrical-01@lineworks-local.info`
- **連動範囲**: `OkuSchedule` シートのみ
- **業者側は連携なし**

### 9.2 Push(App → Calendar)

- **タイミング**: 保存キューフラッシュ時(5秒デバウンス後)
- **冪等性**: LockService + etag楽観ロック
- **エラー処理**:
  - 404/410 → 新規作成にフォールバック
  - 412 → 競合ログ記録

### 9.3 Pull(Calendar → App)

- **方式**: 1分時間トリガー + `syncToken` 増分取得
- **WebApp開いている間**: クライアント側30秒ポーリングで補完
- **410エラー時**: syncToken破棄 → フル同期フォールバック
- **Events.watch 不採用理由**: GAS doPost がリクエストヘッダ取得不可のため

### 9.4 マッピング(双方向冗長化)

- Sheet側: `OkuSchedule.googleEventId` + `etag`
- Calendar側: `extendedProperties.private.appRowKey = scheduleId`

### 9.5 イベント形式

- **タイトル**: `LW25056 電気工事`(短縮版)
- **description**: `納入先: ○○ / 製品: ○○ / メモ: ○○`
- **タイムゾーン**: `Asia/Tokyo`(明示)
- **終日 or 時刻指定**: 終日(`start.date` / `end.date`)
- **繰返し**: 非対応(`singleEvents: true`)

### 9.6 削除動作

- アプリで削除 → Calendar もハード削除
- Calendar で削除 → アプリからも削除

### 9.7 競合解決

- **自動マージしない**
- 両側更新検知 → `ConflictLog` に記録 + UI で警告表示 + 人間判断

---

## 10. 保存方式(Guest-Check-in-App パターン)

### 10.1 SAVE_QUEUE 実装

```javascript
var SAVE_QUEUE = {
  pending: {},      // { scheduleId: { field: value } }
  timer: null,
  delay: 5000,      // 5秒スライディングデバウンス
  isSaving: false,
  retryCount: 0,
  maxRetries: 3
};
```

### 10.2 フロー

1. ユーザー編集 → `queueUpdate(id, updates)` → ローカル状態即更新(Optimistic UI)
2. 既存タイマー `clearTimeout` → 新規5秒タイマーセット
3. 5秒経過 → `flushSaveQueue()` 直列実行
4. 成功 → `✓ 保存済み`
5. 失敗 → `queueUpdateSilent()` で再キュー → 最大3回リトライ
6. リトライ上限超 → `✕ エラー` + トースト警告

### 10.3 保護機構

- **beforeunload**: 未保存データあり → `flushSaveQueue()` 強制実行 + 警告ダイアログ
- **isSaving フラグ**: 同時実行防止
- **LockService**: サーバー側でGAS同時実行防止
- **直列保存**: GAS同時実行制限を超えないよう1件ずつ順に送信

### 10.4 UI表示

| ステータス | 表示 | 色 |
|---|---|---|
| saved | `✓ 保存済み` | 緑 |
| unsaved | `● 未保存` | 赤系 |
| saving | `⟳ 保存中...` | 黄金色 |
| error | `✕ 保存エラー` | 赤系 |

右上固定バッジ + トースト通知(3秒表示)で状態を可視化。

---

## 11. 業者色の初期自動割当(提案)

| contractorId | 業者名 | 識別色 | 色名 |
|---|---|---|---|
| C001 | H・Y・Tシステム | `#3B82F6` | ブルー |
| C002 | 有限会社サンスイ | `#10B981` | エメラルド |
| C003 | 坂野電気工業所 | `#F59E0B` | アンバー |
| C004 | 株式会社内山電機製作所 | `#8B5CF6` | バイオレット |
| C005 | 株式会社桜井電装 | `#EC4899` | ピンク |
| C006 | RCエンジニアリング株式会社 | `#06B6D4` | シアン |

いずれもダーク背景で映える彩度。後からUI上で変更可能。

---

## 12. 実装フェーズ

### Phase 1: 基盤構築

1. リポジトリ初期化(clasp設定、README、.gitignore)
2. 新スプレッドシート作成 + シート7枚作成
3. 初期マスタ投入(電気工程13件、業者6社)
4. 中継GAS新規作成 + 本番生産工程表SSへの読取権限付与
5. タブシェル実装(Guest-Check-in-Appパターン移植 + ダークテーマ)
6. SAVE_QUEUE + beforeunloadガード実装

### Phase 2: ガント管理

7. ガントコア描画(生産工程表から移植・ダーク化)
8. 奥氏エリア(工番追加、ドラッグ入力、モーダル)
9. 業者エリア(6行、レーン分割、モーダル)
10. 工番情報右端列 + 検索プルダウン

### Phase 3: カレンダー

11. FullCalendar v6 組込(奥氏カレンダー)
12. 業者サブタブ ×6(FullCalendar + 連絡先 + 依頼メモ)
13. 作業状況/依頼状況メモCRUD

### Phase 4: ゴースト表示

14. 中継GAS の `getGhostSchedules` 実装
15. 奥氏ガント背景にゴースト描画
16. クリック → 詳細ポップアップ

### Phase 5: Calendar連携

17. Advanced Calendar Service有効化 + スコープ追加
18. App→Cal push実装(create/update/delete)
19. Cal→App pull実装(syncToken増分)
20. 1分トリガー + クライアントポーリング
21. 競合ログ + UI警告

### Phase 6: 仕上げ

22. 配色チューニング(ダーク画面での視認性)
23. エラーメッセージ整備
24. 権限管理(Permissions シート)
25. 動作テスト + 実データ投入

---

## 13. 調査で判明した重要事項

### 13.1 工番フォーマット(外部_工番マスタ実データより)

- **主流**: `LW` + 5桁数字(例: `LW25056`, `LW24001`, `LW23012`)
- **例外**: 短縮コード(`99-0-25`, `SE-25` など特殊案件用)
- **件数**: 外部_工番マスタ **829行**
- **連結**: `工番` 文字列で完全一致可能 → ゴースト紐付け問題なし

### 13.2 Jobs シートのデータ汚染に注意

24列中、重複列あり:

- `住所` と `納入先住所`(別物として共存)
- `subPersonId` と `subPersonId `(末尾スペース付き、ゴミ列)

→ 新アプリ実装時は**列名の trim + 片方のみ採用**するロジックが必要

### 13.3 ProcessMaster の isWeekly 5工程(確定)

| processId | 工程名 | 色 |
|---|---|---|
| P065 | 電気工事 | `#1F4E79`(濃紺) |
| P080 | ロボットセットアップ | `#7030A0`(紫) |
| M100 | 立会 | `#FFD966`(黄) |
| M140 | 出荷 | `#FFC000`(濃黄) |
| P150 | 据付/現地工事 | `#548235`(緑) |

### 13.4 Schedule シート正規化構造(確認済)

```
scheduleId / jobId(UUID) / processId / start / end
/ mainPersonId / subPersonId / label / status / memo
/ updatedAt / updatedBy
```

想定通りの完全正規化。1行=1工程×1期間。

### 13.5 重要事項ヘッダの全角カッコ注意

生産工程表の ProcessMaster シートのヘッダは `重要(isWeekly)` ではなく **`重要(isWeekly)`**(半角カッコ)。ただし実際は**全角カッコ版が混在する可能性**があるため、アクセス時は両対応が安全。

### 13.6 8エージェント調査結果サマリ

| # | 調査対象 | 主要な発見 |
|---|---|---|
| A1 | 生産工程表GitHub | Vanilla JS + Tailwind、Gantt完全実装、コピー可能 |
| A2 | Guest-Check-in-App | タブ方式・全ページプリロード完全実装 |
| A3 | 新リポジトリ | 完全に空、ゼロから設計可能 |
| A4 | 生産工程表SS | Schedule+Jobs 正規化、UUID連結 |
| A5 | 工番マスタSS | Excel経由で 829行 確認済 |
| A6 | GAS Calendar連携 | 現状一方向(read only)、書込は新規実装必要 |
| A7 | UIライブラリ | Ganttスクラッチ流用 + FullCalendar v6 を推奨 |
| A8 | Calendar双方向同期 | Advanced Calendar Service + syncToken |

---

## 14. 未確定の軽微事項(実装中に確認)

- 工番情報ホバー表示の詳細レイアウト
- ゴースト詳細ポップアップのデザイン
- ガント日付範囲切替UIの見た目
- 月切替のアニメーション
- サブタブ切替時のイベントソースキャッシュ戦略

---

## 15. 参考ドキュメント

### 既存システム

- **生産工程表 GitHub**: https://github.com/skyblueearthjapan/Manufacturing-schedule-list.git
- **生産工程表 SS**: `1tBwMSYpWtt9ozLh8bd7CE68HM1mITSpzTvr6Y4uOHRM`
- **生産工程表 GAS**: `1RiJP0j4oHj63raNa4064swYscqkNcKbX6w2DS5FAG80BiA2uWK6oUvXy`
- **Guest-Check-in-App GitHub**: https://github.com/skyblueearthjapan/Guest-Check-in-App.git
- **工番マスタ SS**: `1iu5HoaknlW1W1HheeYv0jqcRq-aY0SyEE2seQd2pHkQ`

### 新規システム

- **GitHub**: https://github.com/skyblueearthjapan/Electrical-Work-Scheduling.git
- **GAS**: `1HdVLArk51QlFxm8YxHtyBtR8jSOMraTUhXDFfaJiPtLIr4K7Y-TEdvrR`
- **SS**: (新規作成予定)

### デザイン参考

- Notion Calendar(スクショ: `スクショ/ノーションカレンダー参考.png`)

### 外部ライブラリ

- FullCalendar v6.1.20: https://cdn.jsdelivr.net/npm/fullcalendar@6.1.20/index.global.min.js
- Tailwind CDN: https://cdn.tailwindcss.com

### Google API ドキュメント

- [Advanced Calendar Service](https://developers.google.com/apps-script/advanced/calendar)
- [Calendar API v3 Events](https://developers.google.com/workspace/calendar/api/v3/reference/events)
- [Extended Properties](https://developers.google.com/workspace/calendar/api/guides/extended-properties)

---

## 承認欄

| 項目 | 状態 |
|---|---|
| 全体方針 | ☐ 承認 / ☐ 修正あり |
| 業者色初期割当 | ☐ 承認 / ☐ 修正あり |
| 中継GAS新設 | ☐ 承認 / ☐ 修正あり |
| 実装着手タイミング | 要指示 |
| 新規SS作成担当 | ☐ Claude / ☐ ユーザー |

**承認後、Phase 1 から順次実装開始いたします。**

---

*本書は 8 エージェントによる並列調査(生産工程表GitHub/Guest-Check-in-App/新リポジトリ/生産工程表SS/工番マスタ/GAS Calendar/UIライブラリ/Calendar双方向同期)の結果を統合して作成されました。*
