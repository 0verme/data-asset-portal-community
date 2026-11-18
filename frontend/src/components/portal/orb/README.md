# DataOrb

```tsx
import { DataOrb } from "./components/portal/orb/DataOrb";

<DataOrb status="idle" effects="subtle" theme="light" />
```

The component accepts the resolved light/dark theme and full/subtle/off preference planned in #593. #596 can pass its mapped status and change `pulseKey` for a typing pulse. Status sets the energy target and the pulse decays in the animated path. Theme adjusts lighting and halo opacity against the host background. The violet, blue, teal and peach palette stays fixed. The component is decorative and accepts a class name. Use `--data-orb-size` to adjust the square frame, whose nominal sphere diameter is 60% of its width.

The static gradient sphere is the first render. The canvas replaces it after the first successful draw. Full targets 30 FPS and caps DPR at 1.5. Subtle targets 20 FPS and caps DPR at 1. Off and reduced motion keep the CSS sphere and allocate zero GL contexts. Intersection and visibility changes stop the animation scheduler and restart it when visible. Browsers without IntersectionObserver use CSS. Moving between full and subtle updates the budget on the current renderer. A GL failure or lost context selects CSS for the lifetime of that mount. Recovering from reduced motion or re-enabling effects allocates a fresh canvas if the mount has had no GL failure.

## Source and compatibility audit

- [B Orb, c00bac8a8405389f8a419d92876664ba9b3e9a6c](https://github.com/fanmihua/data-hub-demo/blob/c00bac8a8405389f8a419d92876664ba9b3e9a6c/src/variants/b/Orb.tsx) supplies the WebGL 1 GLSL ES 1.00 simplex/domain-warped flow, lighting, edge and halo. The port preserves these equations and the fullscreen triangle. It fixes the light direction and removes cursor offset and an unused FBM function. The shader requires fragment highp.
- [Effect helpers](https://github.com/fanmihua/data-hub-demo/blob/c00bac8a8405389f8a419d92876664ba9b3e9a6c/src/core/fx/hooks.ts) supplied sizing, rAF and theme color conversion in the Demo. The port manages local canvas size and frame scheduling with browser APIs. The Demo Provider, global pointer listener, color-probe canvas and rAF loop are omitted. The Demo continued scheduling rAF offscreen and could leave shaders/programs allocated after partial initialization. The port cancels pending work and deletes allocated GPU objects during cleanup and on failure.
- [Variant B CSS](https://github.com/fanmihua/data-hub-demo/blob/c00bac8a8405389f8a419d92876664ba9b3e9a6c/src/variants/b/b.css) informed the four-color palette and gradient fallback. The port uses locally scoped selectors and basic radial gradients with a solid background and inset edge. It requires no assets, fonts, third-party packages, or runtime network requests and builds with DAP's React 19, TypeScript 6 and Vite 8.
- [Demo MIT license](https://github.com/fanmihua/data-hub-demo/blob/c00bac8a8405389f8a419d92876664ba9b3e9a6c/LICENSE) credits © 2026 fanmihua and excludes the Demo's fonts. The shader's simplex code descends from [Ashima Arts / Stefan Gustavson's MIT webgl-noise](https://github.com/ashima/webgl-noise/blob/6abed1e77ed1e18b181627c35f688eb30c9fe75e/LICENSE). Both complete notices are in [frontend/public/licenses/data-orb.txt](../../../../public/licenses/data-orb.txt), served from `licenses/data-orb.txt` in Vite distributions.

## Browser harness

Run the focused Chromium/WebKit tests from `frontend` with the existing Playwright config.

```sh
DAP_KUMO_TEST_OUTPUT="$(mktemp -d)" VITE_API_MODE=mock npm run test:browser -- e2e/data-orb.spec.ts --workers=2
```

The spec opens the isolated development fixture and writes theme/viewport screenshots and a draw-count/DPR report to the Playwright output directory. Vite's frontend production build has only the usual app entry. The test fixture is outside the app tree.
