import { fragmentShader, vertexShader } from "./dataOrbShader.ts";

type OrbFrame = {
  time: number;
  energy: number;
  pulse: number;
  dark: boolean;
  intensity: number;
};

export function createDataOrbRenderer(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("webgl", {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: "low-power",
    failIfMajorPerformanceCaveat: true,
  });
  if (!context) throw new Error("WebGL context unavailable");

  const gl = context;
  let vertex: WebGLShader | null = null;
  let fragment: WebGLShader | null = null;
  let program: WebGLProgram | null = null;
  let buffer: WebGLBuffer | null = null;

  function dispose() {
    if (buffer) gl.deleteBuffer(buffer);
    if (program) {
      gl.useProgram(null);
      gl.deleteProgram(program);
    }
    if (fragment) gl.deleteShader(fragment);
    if (vertex) gl.deleteShader(vertex);
    if (!gl.isContextLost()) gl.getExtension("WEBGL_lose_context")?.loseContext();
  }

  try {
    const precision = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
    if (gl.isContextLost() || !precision?.precision) throw new Error("Fragment highp unavailable");

    vertex = gl.createShader(gl.VERTEX_SHADER);
    fragment = gl.createShader(gl.FRAGMENT_SHADER);
    if (!vertex || !fragment) throw new Error("Unable to allocate Orb shaders");
    gl.shaderSource(vertex, vertexShader);
    gl.compileShader(vertex);
    gl.shaderSource(fragment, fragmentShader);
    gl.compileShader(fragment);
    if (!gl.getShaderParameter(vertex, gl.COMPILE_STATUS) || !gl.getShaderParameter(fragment, gl.COMPILE_STATUS)) {
      throw new Error("Unable to compile Orb shaders");
    }

    program = gl.createProgram();
    if (!program) throw new Error("Unable to allocate Orb program");
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("Unable to link Orb program");
    gl.detachShader(program, vertex);
    gl.detachShader(program, fragment);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    vertex = null;
    fragment = null;

    buffer = gl.createBuffer();
    const position = gl.getAttribLocation(program, "p");
    if (!buffer || position < 0) throw new Error("Orb vertex data unavailable");
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.useProgram(program);
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    const resolution = gl.getUniformLocation(program, "uRes");
    const time = gl.getUniformLocation(program, "uTime");
    const energy = gl.getUniformLocation(program, "uEnergy");
    const pulse = gl.getUniformLocation(program, "uPulse");
    const dark = gl.getUniformLocation(program, "uDark");
    const intensity = gl.getUniformLocation(program, "uFx");

    // B's default violet and aurora colors, fixed across portal themes.
    gl.uniform3f(gl.getUniformLocation(program, "uC1"), 106 / 255, 69 / 255, 240 / 255);
    gl.uniform3f(gl.getUniformLocation(program, "uC2"), 47 / 255, 123 / 255, 1);
    gl.uniform3f(gl.getUniformLocation(program, "uC3"), 25 / 255, 198 / 255, 193 / 255);
    gl.uniform3f(gl.getUniformLocation(program, "uC4"), 1, 179 / 255, 138 / 255);

    if (gl.getError() !== gl.NO_ERROR) throw new Error("Orb WebGL initialization failed");

    return {
      dispose,
      draw(width: number, height: number, frame: OrbFrame) {
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
        gl.uniform2f(resolution, gl.drawingBufferWidth, gl.drawingBufferHeight);
        gl.uniform1f(time, frame.time);
        gl.uniform1f(energy, frame.energy);
        gl.uniform1f(pulse, frame.pulse);
        gl.uniform1f(dark, Number(frame.dark));
        gl.uniform1f(intensity, frame.intensity);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        if (gl.isContextLost()) throw new Error("Orb WebGL context lost");
      },
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
