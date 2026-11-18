// Copyright 2025 Jearhe
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import React from "react";
import ReactDOM from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { AppearanceProvider } from "./appearance/AppearanceProvider.tsx";
import App from "./App.tsx";
import { i18n, i18nReady } from "./i18n/index.ts";
import { ToastHost } from "./ui/index.ts";
import "@cloudflare/kumo/styles/standalone";
import "./styles/app.css";
import "./styles/push.css";
import "./styles/report.css";
import "./styles/upstream.css";
import "./styles/indicator.css";
import "./styles/system.css";
import "./styles/search.css";
import "./styles/kumo-theme.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Unable to mount the application: #root is missing.");
}

const root = ReactDOM.createRoot(rootElement);
const fixturePath = import.meta.env.DEV ? window.location.pathname : "";
const isKumoSpike = fixturePath === "/__kumo-spike";
const isKumoAdapterFixture = fixturePath === "/__kumo-adapters";
const isKumoOverlayFixture = fixturePath === "/__kumo-overlays";
const isKumoToastFallbackFixture = fixturePath === "/__kumo-toast-fallback";
const isFormErrorFixture = fixturePath === "/__form-errors";
const isTablePaginationFixture = fixturePath === "/__table-pagination";

if (fixturePath === "/__appearance") {
  void import("./appearance/AppearanceFixture.tsx").then(({ default: Fixture }) => {
    root.render(<React.StrictMode><Fixture /></React.StrictMode>);
  });
} else if (isKumoSpike || isKumoAdapterFixture || isKumoOverlayFixture || isKumoToastFallbackFixture || isFormErrorFixture || isTablePaginationFixture) {
  const loadFixture = isKumoSpike
    ? import("./kumo-spike/KumoCompatibilityFixture.tsx")
    : isKumoAdapterFixture
      ? import("./kumo-adapters/KumoPrimitiveFixture.tsx")
      : isKumoOverlayFixture
        ? import("./kumo-overlays/KumoOverlayFixture.tsx")
        : isKumoToastFallbackFixture
          ? import("./kumo-overlays/KumoToastFallbackFixture.tsx")
          : isFormErrorFixture
            ? import("./kumo-overlays/FormErrorPresenterFixture.tsx")
            : import("./ui/TablePaginationFixture.tsx");
  void loadFixture.then(({ default: Fixture }) => {
    root.render(
      <React.StrictMode>
        <AppearanceProvider>
          <Fixture />
        </AppearanceProvider>
      </React.StrictMode>,
    );
  });
} else {
  void i18nReady.then(() => {
    root.render(
      <React.StrictMode>
        <I18nextProvider i18n={i18n}>
          <AppearanceProvider>
            <ToastHost>
              <App />
            </ToastHost>
          </AppearanceProvider>
        </I18nextProvider>
      </React.StrictMode>,
    );
  });
}
