# 要件定義 v1.0 レビュー結果統合

**レビュー日:** 2026-04-07
**レビュー体制:** 8名並列エージェント体制
**総合判定:** 全員 **Pass with changes**

## 実装に反映する重要変更(v1.1相当)

### セキュリティ(R2)
- **全ID(SS/GAS/Calendar)は `PropertiesService.getScriptProperties()` 経由で管理**。コードにハードコードしない
- Permissions シート照合を全エンドポイント先頭に実装
- `textContent` 使用を徹底(XSS対策)
- `LockService.waitLock(10000)` 上限明示
- OAuth最小スコープ: `calendar`, `spreadsheets`, `spreadsheets.readonly`, `external_request`

### UI/UX(R4)
- **タブ構造を 3 タブに簡素化**:
  - `ガント管理` / `奥氏カレンダー` / `業者カレンダー`(内部サブタブ6社)
- **ゴースト opacity 0.50 + 斜線パターン**(0.30では不可視)
- デュアルエンコーディング: 縁取り→ **上端4px帯** に変更
- 工番検索はインクリメンタルサーチ combobox
- 業者色: ブルー→ `#60A5FA`、シアン→ `#22D3EE` に調整

### ガント(R5)
- スクロール同期は3要素循環防止フラグ
- `assignLanes` を汎用化(奥氏/業者両対応)
- ゴーストは絶対配置レイヤ(z-index:0)
- Tailwindハードコード→CSS変数化
- `_lastRenderKey` を jobId配列ハッシュに
- モーダルは `OkuModal` / `ContractorModal` 分離

### 保存キュー(R6)
- **デバウンスを 3 秒に短縮**
- **LocalStorage バックアップ必須**(`eleSchedSaveQueue.backup` キー)
- 複数タブ同時編集検出: updatedAt楽観ロック(サーバー409返却)
- 削除時は pending から確実に除外
- Calendar push は保存成功後のみ

### 中継GAS(R7)
- DOMAIN制限 + token パラメータ認証
- キャッシュは工番List ハッシュ + 分割(100KB上限対策)
- レスポンスに `schemaVersion`, `generatedAt`, `cachedAt`
- stale-while-revalidate フォールバック
- 監査ログシート

### Calendar同期(R3)
- `SyncState.pullInProgress` フラグで編集レース防止
- `end.date` の ±1日変換ルール明文化
- Reconcile バッチ(日次)で orphan 掃除
- `OkuSchedule.deletedAt` tombstone 列追加

### データモデル(R1)
- `JobsCache` シート追加(工番スナップショット)
- `ContractorSchedule` に Calendar列(googleEventId/etag/lastSyncedAt)を NULL許容で予約 + 意図コメント
- processId名前空間: アプリ独自工程は `EP001-` プレフィックス
- `TodoList.scope` → `scope_type(oku|contractor) + contractor_id` に分解
- `SchemaVersion` シート追加 + 起動時マイグレータ

### ドキュメント(R8)
- 自由記述工程フロー明文化(マスタ登録 or ad-hoc テキスト保持)
- エラーハンドリング/ログ方針
- デプロイ手順(clasp push + Advanced Service 有効化)
- テスト方針

## 未解決の検討事項(Phase後半で対応)

- beforeunload の `navigator.sendBeacon` 代替検討
- 180日表示時のパフォーマンス検証
- サービスアカウント経由での生産工程表読取
- Calendar 初期バックフィル自動化

---

**これらの変更を実装に直接反映し、Phase 1 から着手する。**
