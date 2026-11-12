# Queria Profile API

地域コードか法人番号を渡すと、その地域・法人のよく使う指標を、時点と出典つきで返す API です。値は Queria の公開データセット `queria/area_profile` と `queria/company_profile` の 1 行です。

## 使い方

```bash
# 市区町村 (5 桁・6 桁) と小地域 (9 桁・11 桁)
curl https://profile.queria.io/v1/areas/08220
# 法人番号 (13 桁)
curl https://profile.queria.io/v1/companies/1180301018771
# 100 件までまとめて
curl -X POST https://profile.queria.io/v1/areas/batch -d '{"codes":["08220","13101"]}'
```

住所や企業名から ID を引くには、ジオコーダー (geocoder.queria.io) と法人名寄せ API (company-resolver.queria.io) を使います。応答の形とデータの読み方は [DESIGN.md](DESIGN.md) にあります。

## 開発

```bash
pnpm install
pnpm test        # vitest (Workers ランタイム)
pnpm typecheck
pnpm check       # oxlint + oxfmt --check
```

テストのデータは `test/make-fixture.py` が作ります。
