import "i18next";

import type auth from "./locales/zh-CN/auth.json" with { "resolution-mode": "import" };
import type common from "./locales/zh-CN/common.json" with { "resolution-mode": "import" };
import type navigation from "./locales/zh-CN/navigation.json" with { "resolution-mode": "import" };
import type warehouse from "./locales/zh-CN/warehouse.json" with { "resolution-mode": "import" };

type DeepStringify<T> = {
  [Key in keyof T]: T[Key] extends string ? string : T[Key] extends object ? DeepStringify<T[Key]> : T[Key];
};

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "common";
    resources: {
      common: DeepStringify<typeof common>;
      navigation: DeepStringify<typeof navigation>;
      auth: DeepStringify<typeof auth>;
      warehouse: DeepStringify<typeof warehouse>;
    };
    returnNull: false;
  }
}
