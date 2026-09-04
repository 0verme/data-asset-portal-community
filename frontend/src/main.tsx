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
import App from "./App.tsx";
import "./styles/app.css";
import "./styles/push.css";
import "./styles/report.css";
import "./styles/upstream.css";
import "./styles/indicator.css";
import "./styles/system.css";
import "./styles/search.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Unable to mount the application: #root is missing.");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
