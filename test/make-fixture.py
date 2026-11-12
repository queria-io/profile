"""テストのデータ (test/fixture/) を作る。

area_profile と company_profile から数行を取り出し、データセットと同じ分け方
(町丁目は prefecture_code、法人は shard) と行グループ (2,048 行) で Parquet に書く。
目録 (area_profile.json・company_profile.json) は src/source.ts の fromManifest が読む形。

    uv run --with duckdb python test/make-fixture.py

読む先は既定で data.queria.io の公開カタログ。手元でビルドしたカタログを読むときは
AREA_PROFILE・COMPANY_PROFILE に DuckLake の ATTACH の文字列を渡す
(例: "ducklake:sqlite:/tmp/ap/work.sqlite")。
"""

import json
import os
import shutil
from pathlib import Path

import duckdb

OUT = Path(__file__).parent / "fixture"
PUBLIC = "ducklake:https://data.queria.io/datasets/queria/{}/ducklake.duckdb"

# つくば市・横浜市・横浜市鶴見区・特別区部・千代田区と、その町丁目の一部
CITY_CODES = ["08220", "14100", "14101", "13100", "13101"]
SMALL_AREA = "key_code LIKE '08220%' OR key_code LIKE '13101%'"
# 下 3 桁が 771 の法人 (トヨタ自動車を含む 1 つの shard)
COMPANIES = "corporate_number LIKE '%771'"

con = duckdb.connect()
con.execute("INSTALL ducklake; LOAD ducklake; INSTALL sqlite; LOAD sqlite; INSTALL httpfs; LOAD httpfs")
con.execute(f"ATTACH '{os.environ.get('AREA_PROFILE', PUBLIC.format('area_profile'))}' AS ap (READ_ONLY)")
con.execute(f"ATTACH '{os.environ.get('COMPANY_PROFILE', PUBLIC.format('company_profile'))}' AS cp (READ_ONLY)")

shutil.rmtree(OUT, ignore_errors=True)
OUT.mkdir(parents=True)


def write(sql: str, path: str, partition: str | None = None) -> list[str]:
    target = OUT / path
    options = "FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 2048"
    target.parent.mkdir(parents=True, exist_ok=True)
    if partition:
        con.execute(f"COPY ({sql}) TO '{target}' ({options}, PARTITION_BY ({partition}), WRITE_PARTITION_COLUMNS true)")
        return sorted(p.relative_to(OUT).as_posix() for p in target.rglob("*.parquet"))
    con.execute(f"COPY ({sql}) TO '{target}' ({options})")
    return [path]


area = {
    "version": "fixture",
    "tables": {
        "profile.city": write(
            f"SELECT * FROM ap.profile.city WHERE city_code IN ({', '.join(repr(c) for c in CITY_CODES)}) ORDER BY city_code",
            "area/city.parquet",
        ),
        "profile.small_area": write(
            f"SELECT * FROM ap.profile.small_area WHERE {SMALL_AREA} ORDER BY key_code",
            "area/small_area",
            "prefecture_code",
        ),
    },
}
company = {
    "version": "fixture",
    "tables": {
        "profile.company": write(
            f"SELECT * FROM cp.profile.company WHERE {COMPANIES} ORDER BY corporate_number",
            "company/company",
            "shard",
        ),
    },
}
(OUT / "area_profile.json").write_text(json.dumps(area, indent=2) + "\n")
(OUT / "company_profile.json").write_text(json.dumps(company, indent=2) + "\n")
