// データセットのファイルの置き場を引く。Worker が知るのは置き場 (FDL のリポジトリのプレフィックス) だけにする。
// refs/heads/main が指すバージョンの files.json (テーブルごとのファイル一覧) から引くので、
// 毎月の Sync で main が進めば、デプロイなしで読む先が切り替わる。
// 置き場が「….json」なら目録 ({ "version", "tables": { "profile.city": ["profile/city/a.parquet"] } }) を読む。テスト用

/** R2 のキーと、分かればフッターの長さ */
export type FileRef = { key: string; footer?: number };
/** バージョンと、テーブル (スキーマ.テーブル) ごとのファイル */
export type Index = { version: string; tables: Record<string, FileRef[]> };

type Manifest = { version: string; tables: Record<string, string[]> };
/** FDL の versions/<ID>/files.json */
type FileList = {
  tables: Record<
    string,
    {
      renamed_columns?: boolean;
      files: { path?: string; deletes?: unknown; footer_bytes?: number }[];
    }
  >;
};

const getText = async (bucket: R2Bucket, key: string): Promise<string> => {
  const object = await bucket.get(key);
  if (!object) throw new Error(`not found: ${key}`);
  return object.text();
};

const dirOf = (key: string) => key.slice(0, key.lastIndexOf("/") + 1);

const mapValues = <A, B>(record: Record<string, A>, f: (a: A, key: string) => B) =>
  Object.fromEntries(Object.entries(record).map(([k, v]) => [k, f(v, k)]));

export const fromManifest = (key: string, m: Manifest): Index => ({
  version: m.version,
  tables: mapValues(m.tables, (paths) => paths.map((p) => ({ key: dirOf(key) + p }))),
});

export const fromFileList = (root: string, version: string, list: FileList): Index => ({
  version,
  tables: mapValues(list.tables, (table, name) => {
    // 削除ファイルや列の改名は、Parquet だけを読むこの Worker では正しく読めない (表はまるごと作り直している)
    if (table.renamed_columns || table.files.some((f) => f.deletes)) {
      throw new Error(`${name} has deletes or renamed columns`);
    }
    return table.files.map((f) => {
      if (!f.path) throw new Error(`${name} has a file outside the repository`);
      return { key: root + f.path, footer: f.footer_bytes };
    });
  }),
});

const load = async (bucket: R2Bucket, source: string): Promise<Index> => {
  if (source.endsWith(".json")) {
    return fromManifest(source, JSON.parse(await getText(bucket, source)) as Manifest);
  }
  const config = JSON.parse(await getText(bucket, `${source}fdl.json`)) as { data_dir?: string };
  const id = (await getText(bucket, `${source}refs/heads/main`)).trim();
  const list = JSON.parse(await getText(bucket, `${source}versions/${id}/files.json`)) as FileList;
  return fromFileList(source + (config.data_dir ?? "data/"), id, list);
};

/** 読む先を覚えておく時間。Sync のあと、遅くともこれだけたてば新しいバージョンを読む */
const TTL_MS = 5 * 60 * 1000;
const cached = new Map<string, { at: number; index: Promise<Index> }>();

/** 置き場のファイル一覧。問い合わせのたびに R2 を 3 回読まないよう、TTL_MS のあいだ覚えておく */
export const loadIndex = (bucket: R2Bucket, source: string, now = Date.now()): Promise<Index> => {
  const hit = cached.get(source);
  if (hit && now - hit.at < TTL_MS) return hit.index;
  const index = load(bucket, source);
  cached.set(source, { at: now, index });
  // 失敗したら覚えない (次の問い合わせで読み直す)
  index.catch(() => {
    if (cached.get(source)?.index === index) cached.delete(source);
  });
  return index;
};

/** テーブルのファイルのうち、パスの「column=value/」が value のもの */
export const partitionFiles = (
  index: Index,
  table: string,
  column: string,
  value: string,
): FileRef[] => (index.tables[table] ?? []).filter((f) => f.key.includes(`/${column}=${value}/`));
