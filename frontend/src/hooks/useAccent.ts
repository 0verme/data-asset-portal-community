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

import { useEffect, useState } from 'react';
import {
  ACCENT_STORAGE_KEY,
  applyAccentAttributes,
  getInitialAccent,
  type AccentPreset,
} from '../utils/ui.ts';

export interface UseAccentResult {
  accent: AccentPreset;
  setAccent: (accent: AccentPreset) => void;
}

export function useAccent(): UseAccentResult {
  const [accent, setAccent] = useState<AccentPreset>(getInitialAccent);

  useEffect(() => {
    applyAccentAttributes(accent, document.documentElement);
    try {
      window.localStorage.setItem(ACCENT_STORAGE_KEY, accent);
    } catch {
      // Theme selection still works when storage is disabled.
    }
  }, [accent]);

  return { accent, setAccent };
}
