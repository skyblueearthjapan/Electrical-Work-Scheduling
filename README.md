# 電気工事スケジューリングアプリ

電気設計(奥氏)と外注電気業者6社のスケジュール統合管理 GAS WebApp。

## 概要

- **タブ構成**: ガント管理 / 奥氏カレンダー / 業者カレンダー(6社サブタブ)
- **ダークテーマ**: 渋くかっこよく × 高視認性
- **ガント**: Excelライクなドラッグ入力 + 自動レーン分割 + ゴースト表示
- **カレンダー**: FullCalendar v6 月表示
- **Google Calendar 双方向同期**: `electrical-01@lineworks-local.info`
- **保存方式**: 楽観的UI + 3秒デバウンス + LocalStorage バックアップ + beforeunload 保護

## 技術スタック

| レイヤ | 採用 |
|---|---|
| Frontend | Vanilla JS + Tailwind CDN + FullCalendar v6.1.20 |
| Backend | Google Apps Script (V8) |
| DB | Google スプレッドシート |
| Deploy | clasp → GAS WebApp |
| Calendar API | Advanced Calendar Service v3 |

## ディレクトリ構成

```
.
├── README.md
├── docs/
│   ├── REQUIREMENTS_v1.0.md       # 要件定義書
│   └── REVIEW_FINDINGS_v1.0.md    # レビュー結果
└── src/
    ├── appsscript.json             # GAS マニフェスト
    ├── Code.gs                     # エントリーポイント + API ルーティング
    ├── Config.gs                   # 設定定数
    ├── DataService.gs              # CRUD 実装
    ├── SetupService.gs             # 初期セットアップ(シート作成+マスタ投入)
    ├── CalendarService.gs          # Google Calendar 双方向同期
    ├── index.html                  # HTML シェル
    ├── styles.html                 # ダークテーマ CSS
    └── scripts.html                # フロント JS (Store/Gantt/Calendar/SaveQueue)
```

## セットアップ手順

### 1. リポジトリクローン

```bash
git clone https://github.com/skyblueearthjapan/Electrical-Work-Scheduling.git
cd Electrical-Work-Scheduling
```

### 2. clasp 設定

```bash
npm install -g @google/clasp
clasp login
```

`.clasp.json` を作成(scriptId は GAS プロジェクトの ID):

```json
{
  "scriptId": "1HdVLArk51QlFxm8YxHtyBtR8jSOMraTUhXDFfaJiPtLIr4K7Y-TEdvrR",
  "rootDir": "./src"
}
```

### 3. ソースプッシュ

```bash
clasp push
```

### 4. 初回セットアップ(GASエディタで実行)

GAS エディタを開き、以下を実行:

1. `setupScriptProperties()` — 必須プロパティを Script Properties に登録
2. `setupInitialSheets()` — スプレッドシートに必要な7シートを作成
3. `setupInitialMasters()` — 電気工程 13件 + 業者 6社を投入

### 5. WebApp デプロイ

GAS エディタ → デプロイ → 新しいデプロイ → 種類「ウェブアプリ」:

- 実行ユーザー: **自分**
- アクセス: **LINE WORKS のユーザー**(ドメイン制限)

発行されたURL を奥氏・今泉様にシェア。

### 6. Google Calendar 連携有効化

GAS エディタ → サービス(+) → **Google Calendar API** を追加。

### 7. 定期トリガー設定

```javascript
installCalendarSyncTrigger();  // GAS エディタで実行
```

1分ごとに `pullFromCalendar()` が動作開始。

## 開発

### ローカル編集 → GAS 反映

```bash
clasp push
```

### GAS → ローカル取り込み

```bash
clasp pull
```

## 仕様書

詳細は [`docs/REQUIREMENTS_v1.0.md`](./docs/REQUIREMENTS_v1.0.md) を参照。

レビュー結果は [`docs/REVIEW_FINDINGS_v1.0.md`](./docs/REVIEW_FINDINGS_v1.0.md) を参照。

## ライセンス

Proprietary — © 2026 LINE WORKS Local
