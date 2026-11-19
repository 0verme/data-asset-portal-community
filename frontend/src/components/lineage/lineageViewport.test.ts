import assert from "node:assert/strict";
import test from "node:test";

import {
  fitTransform,
  focusTransform,
  panTransform,
  sanitize,
  zoomAt,
} from "../../../packages/lineage-viewer/src/interactions/viewport-math.ts";

for (const count of [25, 100]) {
  for (const width of [320, 390, 1100]) {
    test(`viewport fits ${count} fan-out nodes in a ${width}px canvas and recovers after zoom/pan`, () => {
      const scene = { x: -120, y: 10, width: 512, height: (count - 1) * (72 + 32) - 32 };
      const viewport = { width, height: 360 };
      const fit = fitTransform(scene, viewport);
      assert.ok(fit);
      assert.ok(scene.x * fit.scale + fit.translateX >= 0);
      assert.ok(scene.y * fit.scale + fit.translateY >= 0);
      assert.ok((scene.x + scene.width) * fit.scale + fit.translateX <= viewport.width);
      assert.ok((scene.y + scene.height) * fit.scale + fit.translateY <= viewport.height);
      if (count === 100) assert.ok(fit.scale < 0.1);

      const point = { x: 135, y: 82 };
      const zoom = zoomAt(fit, point, 1.2, Math.min(fit.scale, 0.1));
      assert.equal(zoom.scale, fit.scale * 1.2);
      assert.ok(Math.abs((point.x - zoom.translateX) / zoom.scale - (point.x - fit.translateX) / fit.scale) < 1e-8);
      const pan = panTransform(zoom, 28, -11);
      assert.equal(pan.scale, zoom.scale);
      assert.equal(pan.translateX, zoom.translateX + 28);
      assert.equal(focusTransform(fit, viewport, { x: scene.x, y: scene.y })?.scale, fit.scale);
      assert.deepEqual(fitTransform(scene, viewport), fit);
    });
  }
}

test("tiny positive canvases can fit while invalid geometry and transforms are safe", () => {
  const scene = { x: 0, y: 0, width: 224, height: 72 };
  assert.ok(fitTransform(scene, { width: 20, height: 30 }));
  assert.equal(fitTransform(scene, { width: 0, height: 30 }), null);
  assert.equal(fitTransform({ ...scene, width: Infinity }, { width: 320, height: 360 }), null);
  assert.deepEqual(sanitize({ scale: -1, translateX: NaN, translateY: Infinity }), {
    scale: 1, translateX: 0, translateY: 0,
  });
});
