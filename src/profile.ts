// 地域コード・法人番号から、データセットの 1 行を引いて応答の形にする
import { CITY, COMPANY, columnsOf, indicators, SMALL, text, type Value } from "./indicators";
import { findRows, type ReadLog } from "./parquet";
import { type FileRef, type Index, partitionFiles } from "./source";

type Row = Record<string, unknown>;

export type Found<T> = { code: string } & T;
export type Missing = { code: string; error: { code: string; message: string } };

export type Area = {
  area: {
    code: string;
    level: string;
    name: string;
    lg_code: string | null;
    prefecture_code: string;
    parent_code: string | null;
  };
  indicators: Record<string, Value>;
  dataset: { name: string; version: string };
};

export type Company = {
  company: {
    corporate_number: string;
    name: string;
    kind: string | null;
    prefecture_code: string | null;
    city_code: string | null;
    lg_code: string | null;
    city_name: string | null;
    assignment_date: string | null;
  };
  indicators: Record<string, Value>;
  dataset: { name: string; version: string };
};

export type AreaKind = "city" | "lg_code" | "small_area";

/** 市区町村コード (5 桁)・全国地方公共団体コード (6 桁)・小地域コード (9 桁・11 桁) を見分ける */
export const areaKind = (code: string): AreaKind | null =>
  /^\d{5}$/.test(code)
    ? "city"
    : /^\d{6}$/.test(code)
      ? "lg_code"
      : /^(\d{9}|\d{11})$/.test(code)
        ? "small_area"
        : null;

export const isCorporateNumber = (s: string): boolean => /^\d{13}$/.test(s);

const missing = (code: string, message: string, errorCode = "not_found"): Missing => ({
  code,
  error: { code: errorCode, message },
});

const str = text;
/** 必ず値のある列 (キー・名前) */
const req = (v: unknown): string => text(v) ?? "";

const CITY_KEYS = [
  "city_code",
  "lg_code",
  "prefecture_code",
  "city_name",
  "area_level",
  "parent_city_code",
];
const SMALL_KEYS = ["key_code", "prefecture_code", "city_code", "city_name", "area_name"];
const COMPANY_KEYS = [
  "corporate_number",
  "name",
  "company_kind",
  "prefecture_code",
  "city_code",
  "lg_code",
  "city_name",
  "assignment_date",
];

/** キーごとに、読むファイルをまとめて 1 回ずつ読む */
const lookup = async (
  bucket: R2Bucket,
  groups: Map<FileRef, string[]>,
  column: string,
  columns: string[],
  log: ReadLog,
): Promise<Map<string, Row>> => {
  const rows = await Promise.all(
    [...groups].map(([ref, keys]) => findRows<Row>(bucket, ref, column, keys, columns, log)),
  );
  return new Map(rows.flat().map((r) => [req(r[column]), r]));
};

const groupBy = (pairs: [FileRef, string][]): Map<FileRef, string[]> =>
  pairs.reduce(
    (m, [ref, key]) => m.set(ref, [...(m.get(ref) ?? []), key]),
    new Map<FileRef, string[]>(),
  );

const cityArea = (row: Row, version: string): Area => ({
  area: {
    code: req(row.city_code),
    level: req(row.area_level),
    name: req(row.city_name),
    lg_code: str(row.lg_code),
    prefecture_code: req(row.prefecture_code),
    parent_code: str(row.parent_city_code),
  },
  indicators: indicators(CITY, row),
  dataset: { name: "queria/area_profile", version },
});

const smallArea = (row: Row, version: string): Area => ({
  area: {
    code: req(row.key_code),
    level: "small_area",
    name: req(row.city_name) + req(row.area_name),
    lg_code: null,
    prefecture_code: req(row.prefecture_code),
    parent_code: str(row.city_code),
  },
  indicators: indicators(SMALL, row),
  dataset: { name: "queria/area_profile", version },
});

/** 地域コードの並びから、入力の順に地域か「無い」を返す */
export const findAreas = async (
  bucket: R2Bucket,
  index: Index,
  codes: readonly string[],
  log: ReadLog,
): Promise<(Found<Area> | Missing)[]> => {
  const kinds = codes.map((c) => [c, areaKind(c)] as const);
  // 市区町村の表は 1 ファイル (分けて書いていない)
  const cityFile = (index.tables["profile.city"] ?? [])[0];
  const cityColumns = columnsOf(CITY, CITY_KEYS);
  const none = Promise.resolve(new Map<string, Row>());
  const cityCodes = kinds.filter(([, k]) => k === "city").map(([c]) => c);
  const lgCodes = kinds.filter(([, k]) => k === "lg_code").map(([c]) => c);
  const smallPairs = kinds
    .filter(([, k]) => k === "small_area")
    .flatMap(([c]) =>
      partitionFiles(index, "profile.small_area", "prefecture_code", c.slice(0, 2)).map(
        (ref) => [ref, c] as [FileRef, string],
      ),
    );
  const [byCity, byLg, bySmall] = await Promise.all([
    cityFile && cityCodes.length
      ? lookup(bucket, new Map([[cityFile, cityCodes]]), "city_code", cityColumns, log)
      : none,
    cityFile && lgCodes.length
      ? lookup(bucket, new Map([[cityFile, lgCodes]]), "lg_code", cityColumns, log)
      : none,
    smallPairs.length
      ? lookup(bucket, groupBy(smallPairs), "key_code", columnsOf(SMALL, SMALL_KEYS), log)
      : none,
  ]);
  return kinds.map(([code, kind]): Found<Area> | Missing => {
    if (kind === null) {
      return missing(
        code,
        "市区町村コード (5 桁・6 桁) か小地域コード (9 桁・11 桁) を渡してください",
        "invalid_code",
      );
    }
    const row = (kind === "city" ? byCity : kind === "lg_code" ? byLg : bySmall).get(code);
    if (!row) return missing(code, "この地域コードの地域はありません");
    return {
      code,
      ...(kind === "small_area" ? smallArea(row, index.version) : cityArea(row, index.version)),
    };
  });
};

const company = (row: Row, version: string): Company => ({
  company: {
    corporate_number: req(row.corporate_number),
    name: req(row.name),
    kind: str(row.company_kind),
    prefecture_code: str(row.prefecture_code),
    city_code: str(row.city_code),
    lg_code: str(row.lg_code),
    city_name: str(row.city_name),
    assignment_date: str(row.assignment_date),
  },
  indicators: indicators(COMPANY, row),
  dataset: { name: "queria/company_profile", version },
});

/** 法人番号の並びから、入力の順に法人か「無い」を返す。法人番号の下 3 桁 (shard) のファイルを読む */
export const findCompanies = async (
  bucket: R2Bucket,
  index: Index,
  numbers: readonly string[],
  log: ReadLog,
): Promise<(Found<Company> | Missing)[]> => {
  const valid = numbers.filter(isCorporateNumber);
  const pairs = valid.flatMap((n) =>
    partitionFiles(index, "profile.company", "shard", n.slice(-3)).map(
      (ref) => [ref, n] as [FileRef, string],
    ),
  );
  const rows = pairs.length
    ? await lookup(
        bucket,
        groupBy(pairs),
        "corporate_number",
        columnsOf(COMPANY, COMPANY_KEYS),
        log,
      )
    : new Map<string, Row>();
  return numbers.map((n): Found<Company> | Missing => {
    if (!isCorporateNumber(n)) return missing(n, "法人番号は 13 桁の数字です", "invalid_code");
    const row = rows.get(n);
    return row
      ? { code: n, ...company(row, index.version) }
      : missing(n, "この法人番号の現存する法人はありません");
  });
};
