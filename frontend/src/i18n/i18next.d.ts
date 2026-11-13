import "i18next";

import type aiAsk from "./locales/zh-CN/aiAsk.json" with { "resolution-mode": "import" };
import type apiAsset from "./locales/zh-CN/apiAsset.json" with { "resolution-mode": "import" };
import type auth from "./locales/zh-CN/auth.json" with { "resolution-mode": "import" };
import type common from "./locales/zh-CN/common.json" with { "resolution-mode": "import" };
import type fieldMapping from "./locales/zh-CN/fieldMapping.json" with { "resolution-mode": "import" };
import type indicator from "./locales/zh-CN/indicator.json" with { "resolution-mode": "import" };
import type lineage from "./locales/zh-CN/lineage.json" with { "resolution-mode": "import" };
import type navigation from "./locales/zh-CN/navigation.json" with { "resolution-mode": "import" };
import type report from "./locales/zh-CN/report.json" with { "resolution-mode": "import" };
import type search from "./locales/zh-CN/search.json" with { "resolution-mode": "import" };
import type warehouse from "./locales/zh-CN/warehouse.json" with { "resolution-mode": "import" };

type DeepStringify<T> = {
  [Key in keyof T]: T[Key] extends string ? string : T[Key] extends object ? DeepStringify<T[Key]> : T[Key];
};

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "common";
    resources: {
      common: DeepStringify<typeof common>;
      fieldMapping: DeepStringify<typeof fieldMapping>;
      indicator: DeepStringify<typeof indicator>;
      lineage: DeepStringify<typeof lineage>;
      report: DeepStringify<typeof report>;
      navigation: DeepStringify<typeof navigation>;
      auth: DeepStringify<typeof auth>;
      warehouse: DeepStringify<typeof warehouse>;
      search: DeepStringify<typeof search>;
      aiAsk: DeepStringify<typeof aiAsk>;
      apiAsset: DeepStringify<typeof apiAsset>;
    };
    returnNull: false;
  }
}
