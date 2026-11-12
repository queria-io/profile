// 指標ごとの出典と時点。値はデータセットの列をそのまま返し、ここでは計算しない (docs/design/profile-api.md)

/** 時点。列の名前 ({ column }) ならその行の値、文字列ならその値、null は時点を決められない値 */
type AsOf = string | { column: string } | null;
export type Indicator = { name: string; source: string; as_of: AsOf };

export type Value = { value: unknown; as_of: string | null; source: string };

const CENSUS_2025 = "e_stat.census.census_municipality_2025";
const CENSUS_2025_AGE = "e_stat.census.census_municipality_age_2025";
const CENSUS_2020_SMALL = "e_stat.census.census_small_area_age";
const SMALL_AREA = "e_stat.boundary.small_area";
const PLACES = "overturemaps.places.place";

const each = (source: string, as_of: AsOf, names: string[]): Indicator[] =>
  names.map((name) => ({ name, source, as_of }));

const FACILITIES = [
  "facility_count",
  "food_count",
  "grocery_count",
  "shopping_count",
  "medical_count",
  "education_count",
];

/** area_profile.profile.city の列 */
export const CITY: Indicator[] = [
  ...each(CENSUS_2025, "2025", [
    "area_km2",
    "population",
    "households",
    "population_density",
    "population_change_rate_5y",
  ]),
  ...each(CENSUS_2025, "2020", ["population_2020"]),
  ...each(CENSUS_2025_AGE, "2025", [
    "population_under_15",
    "population_15_64",
    "population_65_over",
    "population_75_over",
    "aged_65_over_rate",
  ]),
  ...each("e_stat.census.census_municipality_daytime_population", "2020", [
    "daytime_population",
    "daytime_population_ratio",
  ]),
  ...each("ipss.regional_projection.population", "2050", [
    "projected_population_2050",
    "projected_change_rate_2050",
  ]),
  ...each("e_stat.migration.municipality_migration", { column: "net_migration_year" }, [
    "net_migration",
  ]),
  ...each("e_stat.vital_statistics.vital_events", { column: "vital_statistics_year" }, [
    "births",
    "deaths",
  ]),
  ...each("e_stat.local_finance.fiscal_capacity", { column: "fiscal_year" }, [
    "fiscal_capacity_index",
  ]),
  ...each("e_stat.economic_census.establishment_industry", "2021", ["establishments", "employees"]),
  ...each("e_stat.medical_facility.municipality_facility", { column: "medical_facility_year" }, [
    "hospitals",
    "hospital_beds",
    "general_clinics",
    "dental_clinics",
  ]),
  ...each(PLACES, null, FACILITIES),
];

/** area_profile.profile.small_area の列 */
export const SMALL: Indicator[] = [
  ...each(SMALL_AREA, "2020", ["area_km2", "population", "households", "population_density"]),
  ...each(CENSUS_2020_SMALL, "2020", [
    "population_under_15",
    "population_15_64",
    "population_65_over",
    "population_75_over",
    "aged_65_over_rate",
  ]),
  ...each(PLACES, null, FACILITIES),
  ...each("nlftp.railway.station_passenger", null, [
    "nearest_station_name",
    "nearest_station_distance_m",
  ]),
  ...each("nlftp.railway.station_passenger", { column: "station_passenger_year" }, [
    "nearest_station_passenger_count",
  ]),
  ...each("area_stats.land_price.small_area", { column: "residential_price_year" }, [
    "residential_price_median",
  ]),
  ...each("area_stats.land_price.small_area", { column: "commercial_price_year" }, [
    "commercial_price_median",
  ]),
];

/**
 * company_profile.profile.company の列。出典と時点は行の列 (<名前>_source・<名前>_as_of など) にあり、
 * source は行の値が無いときの既定
 */
export const COMPANY: (Indicator & { source_column: string })[] = [
  ["capital_stock", "capital_stock_source", "capital_stock_as_of"],
  ["employee_number", "employee_number_source", "employee_number_as_of"],
  ["establishment_date", "establishment_source", "establishment_as_of"],
  ["industry", "industry_source", "industry_as_of"],
  ["is_listed", "listing_source", "listing_as_of"],
  ["market_segment", "market_segment_source", "market_segment_as_of"],
  ["securities_code", "securities_code_source", "securities_code_as_of"],
  ["latest_net_sales", "latest_net_sales_source", "latest_net_sales_period"],
  ["average_annual_salary", "average_annual_salary_source", "average_annual_salary_as_of"],
  ["average_age", "average_age_source", "average_age_as_of"],
  ["female_manager_ratio", "female_manager_ratio_source", "female_manager_ratio_as_of"],
  ["subsidy_count", "subsidy_source", "subsidy_as_of"],
  ["subsidy_total_amount", "subsidy_source", "subsidy_as_of"],
  ["procurement_count", "procurement_source", "procurement_as_of"],
  ["procurement_total_amount", "procurement_source", "procurement_as_of"],
].map(([name, source_column, as_of]) => ({
  name,
  source: "company_profile.profile.company",
  source_column,
  as_of: { column: as_of },
}));

/** セルの値を文字列にする。日付は YYYY-MM-DD、値が無ければ null */
export const text = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? v.toISOString().slice(0, 10)
      : typeof v === "string"
        ? v
        : typeof v === "number" || typeof v === "bigint" || typeof v === "boolean"
          ? String(v)
          : JSON.stringify(v);

/** BigInt は JSON にできないので、安全な範囲なら number にする */
export const plain = (v: unknown): unknown =>
  typeof v === "bigint"
    ? Number.isSafeInteger(Number(v))
      ? Number(v)
      : String(v)
    : v instanceof Date
      ? v.toISOString().slice(0, 10)
      : v;

const asOfOf = (as_of: AsOf, row: Record<string, unknown>): string | null =>
  as_of === null ? null : typeof as_of === "string" ? as_of : text(row[as_of.column]);

/** 行から、指標ごとの値・時点・出典を作る */
export const indicators = (
  defs: readonly (Indicator & { source_column?: string })[],
  row: Record<string, unknown>,
): Record<string, Value> =>
  Object.fromEntries(
    defs.map((d) => [
      d.name,
      {
        value: plain(row[d.name] ?? null),
        as_of: asOfOf(d.as_of, row),
        source: (d.source_column ? text(row[d.source_column]) : null) ?? d.source,
      },
    ]),
  );

/** 指標の列と、時点・出典の列 (読む列の一覧) */
export const columnsOf = (
  defs: readonly (Indicator & { source_column?: string })[],
  keys: string[],
): string[] => [
  ...new Set([
    ...keys,
    ...defs.flatMap((d) => [
      d.name,
      ...(d.as_of && typeof d.as_of === "object" ? [d.as_of.column] : []),
      ...(d.source_column ? [d.source_column] : []),
    ]),
  ]),
];
