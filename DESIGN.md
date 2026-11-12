# プロファイル API

地域コードか法人番号を渡すと、その地域・法人のよく使う指標を 1 回で返す API の設計。
ジオコーダー (geocoder.queria.io) と法人名寄せ (company-resolver.queria.io) と同じく、独立した Worker として profile.queria.io で出す。

## 何を返すか

| パス | キー | 中身 (データセット) |
| --- | --- | --- |
| `GET /v1/areas/{code}` | 市区町村コード (5 桁)・全国地方公共団体コード (6 桁)・小地域コード (9 桁・11 桁) | `queria/area_profile` の `profile.city` か `profile.small_area` の 1 行 |
| `POST /v1/areas/batch` | 上と同じコードを 100 件まで | 同じ形の配列 |
| `GET /v1/companies/{corporate_number}` | 法人番号 (13 桁) | `queria/company_profile` の `profile.company` の 1 行 |
| `POST /v1/companies/batch` | 法人番号を 100 件まで | 同じ形の配列 |

- 返すのはデータセットの 1 行だけ。API で値を計算しない。指標を増やすときはデータセットに列を足す
- 任意のテーブルを引く汎用の API は作らない。キーの順に並べ、行グループを小さく書いたテーブルしか Range で速く引けないため。自由な集計は MCP の query と CLI で行う
- 住所や企業名からの引き当ては、ジオコーダーと法人名寄せの役目。プロファイル API は ID (地域コード・法人番号) を受けるだけにし、名前や住所の検索は持たない

## 応答の形

`snake_case`。エラーは `{"error": {"code": "...", "message": "..."}}` で、`code` は機械が分岐に使う値として一度出したら意味を変えない。

```json
{
  "area": {
    "code": "08220",
    "level": "city",
    "name": "つくば市",
    "lg_code": "082201",
    "prefecture_code": "08",
    "parent_code": null
  },
  "indicators": {
    "population": { "value": 268832, "as_of": "2025", "source": "e_stat.census.census_municipality_2025" },
    "fiscal_capacity_index": { "value": 1.1, "as_of": "2024", "source": "e_stat.local_finance.fiscal_capacity" }
  },
  "dataset": { "name": "queria/area_profile", "version": "01a1c830-…" }
}
```

- 値ごとに `as_of` (時点) と `source` (元のテーブル) を付ける。統計ごとに時点が違い、並べただけでは比べ間違えるため
  - `as_of` は、データセットに時点の列 (`fiscal_year` など) があればその値、無ければ列の説明に書いた時点 (Worker の対応表)
  - `source` は Queria のテーブル名 (`<dataset>.<schema>.<table>`)。利用者は同じテーブルを SQL で引いて確かめられる
- `dataset.version` は読んだ FDL のバージョン。同じバージョンを指定して SQL で再現できる
- 値が無い指標は `value: null` で返し、キーは省かない。項目の有無で分岐させないため
- バッチは入力の順に並べ、見つからないキーは `{"code": "...", "error": {"code": "not_found", ...}}` の要素にする。1 件の不正で全体を失敗させない

## データの読み方

ジオコーダー・法人名寄せと同じく、DuckDB もカタログも使わず、R2 の Parquet を Range で読む。

- 読むファイルは、FDL のリポジトリの `refs/heads/main` が指すバージョンの `files.json` から引く。毎月の Sync で main が進めば、デプロイなしで読む先が切り替わる。一覧は 5 分覚えておく
- データセット側で、テーブルをキーで分けて書き、行グループを小さくする。Worker は 1 件の問い合わせで、フッター 1 回と行グループ 1 つだけを読む

| テーブル | ファイルの分け方 | 行グループ | 1 ファイルの行数 |
| --- | --- | --- | --- |
| `area_profile.profile.small_area` | 都道府県コード (`prefecture_code=08/`) | 1,024 行 | 約 4,700 |
| `area_profile.profile.city` | 分けない | 既定 | 約 1,900 (丸ごと読む) |
| `company_profile.profile.company` | 法人番号の下 3 桁 (`shard=123/`) | 2,048 行 | 約 5,000 |

- 表はまるごと作り直す。削除ファイルがあると、Parquet だけを読む Worker が消えた行を返すので、`files.json` に削除が載っていたら読まずにエラーにする (法人名寄せと同じ)
- 実測 (法人名寄せの逆引き): R2 の Parquet で中央値 約 450 ms。速さはバッチと、同じ isolate でのフッターの使い回しで出す。キャッシュは測ってから決める

## Worker

- Cloudflare Workers の 1 本 (queria-profile) で、profile.queria.io で受ける。DuckDB もデータベースも使わない
- 匿名で呼べる。IP ごとの回数の上限 (Rate Limiting のバインディング) は費用を守るためのもので、ふつうの使い方では当たらない高さにする
- CORS は全開 (`Access-Control-Allow-Origin: *`)。cookie を読まない
- データセット (area_profile・company_profile) とは別のリポジトリに置く。列・並び・ファイルの分け方はデータセットの `dbt_project.yml` が決めるので、片方を変えるときはもう片方も直す

## 決めたこと

- パスは `/v1/areas/{code}`・`/v1/companies/{corporate_number}` の 2 本とバッチ
- 値ごとに時点と出典を返す
- データセットは分けたまま (引き当て = geocoder・company_resolver、属性 = area_profile・company_profile) にし、ID だけでつなぐ

## 未決

1. **公的なお金の明細** (`/v1/companies/{corporate_number}/public-funds`)。件数の多い法人があるので、ページ送りの形を決めてから足す
