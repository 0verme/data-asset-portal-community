import assert from "node:assert/strict";
import { test } from "node:test";
import { createDataOrbRenderer } from "./dataOrbGL.ts";

function stubGL(failure?: string) {
  const shaders = new Set<object>();
  const programs = new Set<object>();
  const buffers = new Set<object>();
  let released = 0;
  let draws = 0;
  const gl = {
    NO_ERROR: 0,
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    TRIANGLES: 3,
    drawingBufferWidth: 100,
    drawingBufferHeight: 100,
    isContextLost: () => failure === "lost",
    getShaderPrecisionFormat: () => ({ precision: failure === "precision" ? 0 : 23 }),
    createShader: (type: number) => {
      if (type === 2 && failure === "allocate-fragment") return null;
      const shader = { type };
      shaders.add(shader);
      return shader;
    },
    deleteShader: (shader: object) => assert.ok(shaders.delete(shader)),
    shaderSource() {},
    compileShader(shader: { type: number }) {
      if (shader.type === 2 && failure === "throw-compile") throw new Error("compile exception");
    },
    getShaderParameter: (shader: { type: number }) => failure !== "compile" || shader.type !== 2,
    createProgram: () => {
      const program = {};
      programs.add(program);
      return program;
    },
    deleteProgram: (program: object) => assert.ok(programs.delete(program)),
    attachShader() {},
    detachShader() {},
    linkProgram() {},
    getProgramParameter: () => failure !== "link",
    getAttribLocation: () => 0,
    createBuffer: () => {
      const buffer = {};
      buffers.add(buffer);
      return buffer;
    },
    deleteBuffer: (buffer: object) => assert.ok(buffers.delete(buffer)),
    bindBuffer() {},
    bufferData() {
      if (failure === "upload") throw new Error("buffer upload exception");
    },
    useProgram() {},
    enableVertexAttribArray() {},
    vertexAttribPointer() {},
    getUniformLocation: () => ({}),
    uniform3f() {},
    uniform2f() {},
    uniform1f() {},
    viewport() {},
    drawArrays: () => { draws++; },
    getError: () => failure === "gl-error" ? 1282 : 0,
    getExtension: () => ({ loseContext: () => { released++; } }),
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: (type: string, options: WebGLContextAttributes) => {
      assert.equal(type, "webgl");
      assert.equal(options.failIfMajorPerformanceCaveat, true);
      if (failure === "context-exception") throw new Error("context exception");
      return failure === "null" ? null : gl;
    },
  };
  return {
    canvas: canvas as unknown as HTMLCanvasElement,
    resources: () => [shaders.size, programs.size, buffers.size],
    released: () => released,
    draws: () => draws,
  };
}

test("GL draws and releases all objects after a successful initialization", () => {
  const mock = stubGL();
  const renderer = createDataOrbRenderer(mock.canvas);
  assert.deepEqual(mock.resources(), [0, 1, 1]);
  renderer.draw(100, 100, { time: 6.5, energy: 0, pulse: 0, dark: false, intensity: 1 });
  assert.equal(mock.canvas.width, 100);
  assert.equal(mock.canvas.height, 100);
  assert.equal(mock.draws(), 1);
  renderer.dispose();
  assert.deepEqual(mock.resources(), [0, 0, 0]);
  assert.equal(mock.released(), 1);
});

for (const failure of ["null", "context-exception", "lost", "precision", "allocate-fragment",
  "throw-compile", "compile", "link", "upload", "gl-error"]) {
  test(`GL releases allocations after ${failure}`, () => {
    const mock = stubGL(failure);
    assert.throws(() => createDataOrbRenderer(mock.canvas));
    assert.deepEqual(mock.resources(), [0, 0, 0]);
    assert.equal(mock.released(), ["null", "context-exception", "lost"].includes(failure) ? 0 : 1);
  });
}
