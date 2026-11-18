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

import { useAppearance } from '../appearance/AppearanceProvider.tsx';
import type { AccentPreset } from '../appearance/preferences.ts';

export interface UseAccentResult {
  accent: AccentPreset | 'custom';
  setAccent: (accent: AccentPreset) => void;
}

/** Compatibility facade. Prefer useAppearance for new consumers. */
export function useAccent(): UseAccentResult {
  const { preference, setAccent } = useAppearance();
  return {
    accent: preference.accent.kind === 'preset' ? preference.accent.preset : 'custom',
    setAccent: (preset) => setAccent({ kind: 'preset', preset }),
  };
}
