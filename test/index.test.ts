import { env, exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

// test/make-fixture.py が area_profile と company_profile から取り出した数行
import files from "virtual:fixture";

const BASE = "https://profile.test/v1";

beforeAll(async () => {
  await Promise.all(
    Object.entries(files).map(([path, body]) => env.DATA.put(`fixture/${path}`, body)),
  );
});

const get = (path: string) => exports.default.fetch(`${BASE}${path}`);
const post = (path: string, body: unknown) =>
  exports.default.fetch(`${BASE}${path}`, { method: "POST", body: JSON.stringify(body) });

type Value = { value: unknown; as_of: string | null; source: string };
type Profile = {
  area?: Record<string, unknown>;
  company?: Record<string, unknown>;
  indicators: Record<string, Value>;
};

describe("地域", () => {
  it("市区町村コードで市区町村の指標を返す", async () => {
    const response = await get("/areas/08220");
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const body = (await response.json()) as Profile;
    expect(body.area).toMatchObject({
      code: "08220",
      level: "city",
      name: "つくば市",
      lg_code: "082201",
    });
    expect(body.indicators.population).toMatchObject({
      as_of: "2025",
      source: "e_stat.census.census_municipality_2025",
    });
    expect(typeof body.indicators.population.value).toBe("number");
    // 時点を行の列から取る指標
    expect(body.indicators.fiscal_capacity_index.as_of).toMatch(/^\d{4}$/);
  });

  it("全国地方公共団体コード (6 桁) でも引ける", async () => {
    const body = (await (await get("/areas/082201")).json()) as Profile;
    expect(body.area).toMatchObject({ code: "08220" });
  });

  it("政令指定都市の区は親の市のコードを持つ", async () => {
    const body = (await (await get("/areas/14101")).json()) as Profile;
    expect(body.area).toMatchObject({ level: "ward", parent_code: "14100" });
  });

  it("小地域コードで町丁目の指標を返す", async () => {
    const body = (await (await get("/areas/082200020")).json()) as Profile;
    expect(body.area).toMatchObject({
      code: "082200020",
      level: "small_area",
      name: "つくば市羽成",
      parent_code: "08220",
    });
    expect(body.indicators.population.source).toBe("e_stat.boundary.small_area");
  });

  it("無い地域は 404、形の違うコードは 400", async () => {
    expect((await get("/areas/99999")).status).toBe(404);
    const bad = await get("/areas/abc");
    expect(bad.status).toBe(400);
    expect((await bad.json<{ error: { code: string } }>()).error.code).toBe("invalid_code");
  });
});

describe("バッチ", () => {
  it("入力の順に返し、無いキーはエラーの要素にする", async () => {
    const response = await post("/areas/batch", { codes: ["13101", "99999", "08220"] });
    expect(response.status).toBe(200);
    const { results } = (await response.json()) as {
      results: ({ code: string } & Partial<Profile> & { error?: { code: string } })[];
    };
    expect(results.map((r) => r.code)).toEqual(["13101", "99999", "08220"]);
    expect(results[1].error?.code).toBe("not_found");
    expect(results[2].area).toMatchObject({ name: "つくば市" });
  });

  it("上限を超えたら 400", async () => {
    const codes = Array.from({ length: 101 }, () => "08220");
    expect((await post("/areas/batch", { codes })).status).toBe(400);
  });

  it("本文の形が違えば 400", async () => {
    expect((await post("/areas/batch", { code: "08220" })).status).toBe(400);
  });
});

describe("法人", () => {
  it("法人番号で法人の指標を返し、出典を行の列から取る", async () => {
    const response = await get("/companies/1180301018771");
    expect(response.status).toBe(200);
    const body = (await response.json()) as Profile;
    expect(body.company).toMatchObject({ corporate_number: "1180301018771" });
    expect(body.indicators.is_listed.value).toBe(true);
    expect(body.indicators.average_annual_salary.source).toBe("edinet.main.mart_human_capital");
  });

  it("13 桁でなければ 400、無ければ 404", async () => {
    expect((await get("/companies/123")).status).toBe(400);
    expect((await get("/companies/9999999999771")).status).toBe(404);
  });
});

it("知らないパスは 404", async () => {
  expect((await get("/unknown/1")).status).toBe(404);
});
