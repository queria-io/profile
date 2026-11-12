# CLAUDE.md

Queria のプロファイル API (profile.queria.io)。地域コードか法人番号を受けて、`queria/area_profile` と `queria/company_profile` の 1 行を返す Cloudflare Worker。応答の形とデータの読み方は [DESIGN.md](DESIGN.md) が正。

- ID だけを受ける。名前や住所の検索はジオコーダーと法人名寄せ API の役目なので、ここには入れない
- API で値を計算しない。指標を増やすときはデータセットに列を追加し、`src/indicators.ts` に載せる
- R2 の Parquet を Range で読む。テーブルの列・並び・行グループ・ファイルの分け方はデータセットの `dbt_project.yml` が決めるので、片方だけ変えない
- `pnpm test`・`pnpm typecheck`・`pnpm check` を通してから PR を出す
- `main` への直接コミットはしない。PR にして出し、マージは人間が行う。コミットメッセージは Conventional Commits
