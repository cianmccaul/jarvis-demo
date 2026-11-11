// Shader background: copied unchanged from site-monitor/dashboard/index.html.
// ---------- Shader background config — edit these freely ----------
const SHADER_CONFIG = {
  color1: [0x19/255, 0x2d/255, 0xff/255],  // #192dff
  color2: [0x21/255, 0x85/255, 0xff/255],  // #2185ff
  color3: [0x00/255, 0x00/255, 0x18/255],  // #000018
  brightness: 1.2,
  speed: 0.03,      // lower = slower drift
  density: 1.2,
  strength: 3.4,
  frameRate: 10,    // capped low on purpose — calm, not busy
};

function initShaderBg() {
  const canvas = document.getElementById('shaderBg');
  const gl = canvas.getContext('webgl');
  if (!gl) { canvas.style.display = 'none'; return; }

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const vertSrc = `
    attribute vec2 aPos;
    void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
  `;
  const fragSrc = `
    precision highp float;
    uniform vec2 uResolution;
    uniform float uTime;
    uniform vec3 uColor1;
    uniform vec3 uColor2;
    uniform vec3 uColor3;
    uniform float uSpeed;
    uniform float uDensity;
    uniform float uStrength;
    uniform float uBrightness;

    void main() {
      vec2 uv = gl_FragCoord.xy / uResolution.xy;
      vec2 p = uv * 2.0 - 1.0;
      p.y *= uResolution.y / uResolution.x;

      float t = uTime * uSpeed;
      float wave = sin((p.x * uDensity + t) * 3.0) * 0.5
                 + cos((p.y * uDensity - t * 0.7) * 3.0) * 0.5;
      wave *= uStrength * 0.15;

      float mixA = smoothstep(-1.0, 1.0, p.y + wave);
      vec3 col = mix(uColor3, uColor1, mixA);
      float mixB = smoothstep(0.25, 1.0, uv.x + wave * 0.3);
      col = mix(col, uColor2, mixB);
      col *= uBrightness;

      gl_FragColor = vec4(col, 1.0);
    }
  `;

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  }

  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, vertSrc));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragSrc));
  gl.linkProgram(program);
  gl.useProgram(program);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const uResolution = gl.getUniformLocation(program, 'uResolution');
  const uTime = gl.getUniformLocation(program, 'uTime');
  gl.uniform3fv(gl.getUniformLocation(program, 'uColor1'), SHADER_CONFIG.color1);
  gl.uniform3fv(gl.getUniformLocation(program, 'uColor2'), SHADER_CONFIG.color2);
  gl.uniform3fv(gl.getUniformLocation(program, 'uColor3'), SHADER_CONFIG.color3);
  gl.uniform1f(gl.getUniformLocation(program, 'uSpeed'), SHADER_CONFIG.speed);
  gl.uniform1f(gl.getUniformLocation(program, 'uDensity'), SHADER_CONFIG.density);
  gl.uniform1f(gl.getUniformLocation(program, 'uStrength'), SHADER_CONFIG.strength);
  gl.uniform1f(gl.getUniformLocation(program, 'uBrightness'), SHADER_CONFIG.brightness);

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(uResolution, canvas.width, canvas.height);
  }
  resize();
  window.addEventListener('resize', resize);

  let t0 = performance.now();
  function frame() {
    gl.uniform1f(uTime, (performance.now() - t0) / 1000);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (!reduceMotion) {
      setTimeout(() => requestAnimationFrame(frame), 1000 / SHADER_CONFIG.frameRate);
    }
  }
  frame();
}
if ('requestIdleCallback' in window) {
  requestIdleCallback(initShaderBg);
} else {
  setTimeout(initShaderBg, 50);
}
