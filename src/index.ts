// プロファイル API (DESIGN.md)。地域コード・法人番号から、area_profile・company_profile の 1 行を返す。
// 匿名で呼べる。回数の上限は IP ごと
import { type ReadLog } from "./parquet";
import { findAreas, findCompanies } from "./profile";
import { loadIndex } from "./source";

export type Env = {
  /** データセットの置き場 (R2) */
  DATA: R2Bucket;
  /** area_profile の FDL のリポジトリ (「…/」) か目録 (「….json」)。src/source.ts */
  AREA_PROFILE_SOURCE: string;
  /** company_profile の置き場。同上 */
  COMPANY_PROFILE_SOURCE: string;
  /** IP ごとの回数の上限。テストでは無い */
  LIMITER?: RateLimit;
};

/** バッチで受けるキーの数の上限 */
export const MAX_BATCH = 100;

const HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "Authorization, Content-Type",
};

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...headers } });

const error = (status: number, code: string, message: string) =>
  json({ error: { code, message } }, status);

/** 1 件の応答。見つからなければ 404 か 400 (エラーの code で分ける) */
const single = <T extends { code: string }>(
  found: T | { code: string; error: { code: string; message: string } },
) =>
  "error" in found
    ? error(found.error.code === "invalid_code" ? 400 : 404, found.error.code, found.error.message)
    : json(Object.fromEntries(Object.entries(found).filter(([k]) => k !== "code")));

/** バッチの本文 ({ "codes": [...] }) を読む。不正なら null */
const readCodes = async (request: Request): Promise<string[] | null> => {
  const body: unknown = await request.json().catch(() => null);
  const codes = (body as { codes?: unknown } | null)?.codes;
  return Array.isArray(codes) && codes.every((c) => typeof c === "string") ? codes : null;
};

const route = async (request: Request, env: Env, log: ReadLog): Promise<Response> => {
  const { pathname } = new URL(request.url);
  const [, v1, kind, key, ...rest] = pathname.split("/");
  if (v1 !== "v1" || rest.length > 0 || (kind !== "areas" && kind !== "companies") || !key) {
    return error(404, "not_found", "このパスはありません");
  }
  const find = kind === "areas" ? findAreas : findCompanies;
  const source = kind === "areas" ? env.AREA_PROFILE_SOURCE : env.COMPANY_PROFILE_SOURCE;
  if (key === "batch") {
    if (request.method !== "POST") return error(405, "method_not_allowed", "POST で呼んでください");
    const codes = await readCodes(request);
    if (!codes) return error(400, "invalid_body", '本文は {"codes": ["..."]} の形にしてください');
    if (codes.length > MAX_BATCH) {
      return error(400, "too_many_codes", `1 回に ${MAX_BATCH} 件までです`);
    }
    const index = await loadIndex(env.DATA, source);
    return json({ results: await find(env.DATA, index, codes, log) });
  }
  if (request.method !== "GET") return error(405, "method_not_allowed", "GET で呼んでください");
  const index = await loadIndex(env.DATA, source);
  const [found] = await find(env.DATA, index, [decodeURIComponent(key)], log);
  return single(found);
};

export default {
  async fetch(request, env): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: HEADERS });
    // 鍵は呼んだ元の IP。上限は Cloudflare の拠点ごとに数えるので目安
    const ip = request.headers.get("cf-connecting-ip");
    if (env.LIMITER && ip && !(await env.LIMITER.limit({ key: ip })).success) {
      return error(429, "rate_limited", "呼び出しが多すぎます。時間をおいてください");
    }
    const log: ReadLog = { reads: 0, bytes: 0 };
    const started = Date.now();
    try {
      const response = await route(request, env, log);
      console.log(
        JSON.stringify({
          path: new URL(request.url).pathname,
          status: response.status,
          ms: Date.now() - started,
          ...log,
        }),
      );
      return response;
    } catch (e) {
      console.error(e);
      return error(500, "internal", "サーバーで問題が起きました");
    }
  },
} satisfies ExportedHandler<Env>;
