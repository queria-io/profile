// cloudflare:test / cloudflare:workers の型に、この Worker のバインディングと export を与える
declare namespace Cloudflare {
  interface Env {
    DATA: R2Bucket;
    AREA_PROFILE_SOURCE: string;
    COMPANY_PROFILE_SOURCE: string;
  }
  interface GlobalProps {
    mainModule: typeof import("../src/index");
  }
}

declare module "virtual:fixture" {
  /** test/fixture/ の Parquet と目録。キーは test/fixture/ からの相対パス */
  const files: Record<string, ArrayBuffer>;
  export default files;
}
