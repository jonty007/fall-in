// WebGL2 renderer: scene (geodesic ray tracing) -> bloom / telescope blur -> composite.
import { sceneFrag, fullscreenVert } from './shaders/scene.js';
import { downFrag, upFrag, blurFrag, softFrag, compositeFrag, overlayFrag } from './shaders/post.js';
import { buildBlackbodyLUT, buildDiskProfile, BB_LUT, DISK_LUT } from './physics.js';

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    const lines = src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n');
    throw new Error('Shader compile error:\n' + log + '\n' + lines.slice(0, 200000));
  }
  return s;
}
function program(gl, vs, fsSrc) {
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fsSrc));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Link error: ' + gl.getProgramInfoLog(p));
  const uniforms = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    uniforms[info.name] = gl.getUniformLocation(p, info.name);
  }
  return { p, u: uniforms };
}

function makeTex(gl, w, h) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}
// attachments: 1 (default) or 3 (scene: full image + disk-only image + sub-pixel rings)
function target(gl, w, h, attachments = 1) {
  const tex = makeTex(gl, w, h);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  let tex2 = null, tex3 = null;
  if (attachments === 3) {
    tex2 = makeTex(gl, w, h);
    tex3 = makeTex(gl, w, h);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, tex2, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT2, gl.TEXTURE_2D, tex3, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
  }
  const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (st !== gl.FRAMEBUFFER_COMPLETE) throw new Error('FBO incomplete ' + st);
  return { tex, tex2, tex3, fb, w, h };
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      antialias: false, alpha: false, depth: false, stencil: false,
      preserveDrawingBuffer: true, premultipliedAlpha: false, powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 not available');
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('EXT_color_buffer_float missing');
    gl.getExtension('OES_texture_float_linear');
    this.gl = gl;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    this.rendererName = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);

    const vs = compile(gl, gl.VERTEX_SHADER, fullscreenVert);
    this.scene = program(gl, vs, sceneFrag);
    this.down = program(gl, vs, downFrag);
    this.up = program(gl, vs, upFrag);
    this.blur = program(gl, vs, blurFrag);
    this.soft = program(gl, vs, softFrag);
    this.comp = program(gl, vs, compositeFrag);
    this.ovl = program(gl, vs, overlayFrag);
    this.uiTex = gl.createTexture();
    this.vao = gl.createVertexArray();

    // LUT texture: row 0 blackbody, row 1 disk temperature profile
    const bb = buildBlackbodyLUT();
    const disk = buildDiskProfile();
    this.diskPeakRadius = disk.rpeak;
    const N = BB_LUT.N;
    if (DISK_LUT.N !== N) throw new Error('LUT size mismatch');
    const data = new Float32Array(N * 2 * 4);
    data.set(bb, 0);
    for (let i = 0; i < N; i++) data[(N + i) * 4] = disk.T[i];
    this.lut = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.lut);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, N, 2, 0, gl.RGBA, gl.FLOAT, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.resize(canvas.width, canvas.height);
  }

  resize(w, h) {
    const gl = this.gl;
    this.w = w; this.h = h;
    this.sceneT = target(gl, w, h, 3);
    this.thinA = target(gl, w, h);
    this.bloomDown = [];
    this.bloomUp = [];
    let bw = Math.ceil(w / 2), bh = Math.ceil(h / 2);
    for (let i = 0; i < 6; i++) {
      this.bloomDown.push(target(gl, bw, bh));
      this.bloomUp.push(target(gl, bw, bh));
      bw = Math.max(1, Math.ceil(bw / 2)); bh = Math.max(1, Math.ceil(bh / 2));
    }
    // telescope blur at 1/8 resolution
    this.teleA = target(gl, Math.ceil(w / 8), Math.ceil(h / 8));
    this.teleB = target(gl, Math.ceil(w / 8), Math.ceil(h / 8));
    this.half = target(gl, Math.ceil(w / 2), Math.ceil(h / 2));
    this.quarter = target(gl, Math.ceil(w / 4), Math.ceil(h / 4));
  }

  pass(prog, tgt, setup) {
    const gl = this.gl;
    gl.useProgram(prog.p);
    if (tgt) { gl.bindFramebuffer(gl.FRAMEBUFFER, tgt.fb); gl.viewport(0, 0, tgt.w, tgt.h); }
    else { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this.w, this.h); }
    setup(prog.u);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  bindTex(unit, tex, loc) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(loc, unit);
  }

  // Render the expensive scene pass in horizontal tiles so no single GPU task runs too long.
  async renderScene(s, { tileRows = 0 } = {}) {
    const gl = this.gl;
    const u = this.scene.u;
    gl.useProgram(this.scene.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneT.fb);
    gl.viewport(0, 0, this.w, this.h);
    gl.uniform2f(u.uRes, this.w, this.h);
    gl.uniform3fv(u.uCamPos, s.camPos);
    gl.uniform3fv(u.uCamRight, s.camRight);
    gl.uniform3fv(u.uCamUp, s.camUp);
    gl.uniform3fv(u.uCamFwd, s.camFwd);
    gl.uniform1f(u.uTanHalfFov, Math.tan((s.fov * Math.PI) / 360));
    gl.uniform1f(u.uTime, s.diskTime);
    gl.uniform1f(u.uTpeak, s.tPeak);
    gl.uniform1f(u.uRin, s.rIn);
    gl.uniform1f(u.uRout, s.rOut);
    gl.uniform4fv(u.uWipe, s.wipe);
    gl.uniform1f(u.uDiskGain, s.diskGain);
    gl.uniform1f(u.uStarGain, s.starGain);
    gl.uniform1f(u.uGalaxyGain, s.galaxyGain);
    gl.uniform1f(u.uSpin, s.spin);
    gl.uniform3fv(u.uOmega, s.omega || [0, 0, 0]);
    gl.uniform3fv(u.uViewRot, s.viewRot || [0, 0, 0]);
    gl.uniform1f(u.uDr, s.dr || 0);
    this.bindTex(0, this.lut, u.uLut);
    gl.bindVertexArray(this.vao);
    const rows = tileRows > 0 ? tileRows : this.h;
    gl.enable(gl.SCISSOR_TEST);
    for (let y = 0; y < this.h; y += rows) {
      gl.scissor(0, y, this.w, Math.min(rows, this.h - y));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (tileRows > 0) {
        gl.finish();
        await new Promise((r) => setTimeout(r, 0));
        gl.useProgram(this.scene.p);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneT.fb);
        gl.bindVertexArray(this.vao);
      }
    }
    gl.disable(gl.SCISSOR_TEST);
  }

  post(s) {
    const gl = this.gl;
    // bloom chain
    let src = this.sceneT;
    for (let i = 0; i < this.bloomDown.length; i++) {
      const dst = this.bloomDown[i];
      this.pass(this.down, dst, (u) => {
        this.bindTex(0, src.tex, u.uSrc);
        gl.uniform2f(u.uSrcTexel, 1 / src.w, 1 / src.h);
        gl.uniform1f(u.uThreshold, i === 0 ? s.bloomThreshold : -1);
        gl.uniform1f(u.uKnee, s.bloomThreshold * 0.5);
        gl.uniform1f(u.uScale, i === 0 ? s.exposure : 1);
      });
      src = dst;
    }
    let coarse = this.bloomDown[this.bloomDown.length - 1];
    for (let i = this.bloomDown.length - 2; i >= 0; i--) {
      const dst = this.bloomUp[i];
      this.pass(this.up, dst, (u) => {
        this.bindTex(0, coarse.tex, u.uSrc);
        this.bindTex(1, this.bloomDown[i].tex, u.uBase);
        gl.uniform2f(u.uSrcTexel, 1 / coarse.w, 1 / coarse.h);
        gl.uniform1f(u.uRadius, 1.0);
      });
      coarse = dst;
    }
    const bloomTex = this.bloomUp[0].tex;

    // soften the sub-pixel rings: horizontal into thinA, vertical into thinB
    const sig = 2.2 * (this.h / 2160);
    this.pass(this.soft, this.thinA, (u) => {
      this.bindTex(0, this.sceneT.tex3, u.uSrc);
      gl.uniform2f(u.uDir, 1 / this.w, 0);
      gl.uniform1f(u.uSigma, Math.max(sig, 0.8));
    });
    if (!this.thinB) this.thinB = target(gl, this.w, this.h);
    this.pass(this.soft, this.thinB, (u) => {
      this.bindTex(0, this.thinA.tex, u.uSrc);
      gl.uniform2f(u.uDir, 0, 1 / this.h);
      gl.uniform1f(u.uSigma, Math.max(sig, 0.8));
    });

    // telescope blur (only when used)
    if (s.teleSplit[2] > 0) {
      // the telescope view uses the disk-only image: a radio interferometer sees no starlight
      const chain = [this.half, this.quarter, this.teleA];
      let src2 = this.sceneT;
      for (const dst of chain) {
        this.pass(this.down, dst, (u) => {
          this.bindTex(0, src2 === this.sceneT ? this.sceneT.tex2 : src2.tex, u.uSrc);
          gl.uniform2f(u.uSrcTexel, 1 / src2.w, 1 / src2.h);
          gl.uniform1f(u.uThreshold, -1);
          gl.uniform1f(u.uKnee, 1);
          gl.uniform1f(u.uScale, src2 === this.sceneT ? s.exposure : 1);
        });
        src2 = dst;
      }
      const sig = Math.min(s.teleSigmaPx / 8, 11);
      this.pass(this.blur, this.teleB, (u) => {
        this.bindTex(0, this.teleA.tex, u.uSrc);
        gl.uniform2f(u.uDir, 1 / this.teleA.w, 0);
        gl.uniform1f(u.uSigma, sig);
      });
      this.pass(this.blur, this.teleA, (u) => {
        this.bindTex(0, this.teleB.tex, u.uSrc);
        gl.uniform2f(u.uDir, 0, 1 / this.teleA.h);
        gl.uniform1f(u.uSigma, sig);
      });
    }

    this.pass(this.comp, null, (u) => {
      this.bindTex(0, this.sceneT.tex, u.uScene);
      this.bindTex(1, bloomTex, u.uBloom);
      this.bindTex(2, this.teleA.tex, u.uTele);
      this.bindTex(3, this.thinB.tex, u.uThin);
      this.bindTex(4, this.sceneT.tex2, u.uDisk);
      this.bindTex(5, this.sceneT.tex3, u.uThinRaw);
      gl.uniform2f(u.uRes, this.w, this.h);
      gl.uniform2fv(u.uCompress, s.compress || [1, 1]);
      gl.uniform1f(u.uExposure, s.exposure);
      gl.uniform1f(u.uBloomStrength, s.bloomStrength);
      gl.uniform4fv(u.uTeleSplit, s.teleSplit);
      gl.uniform1f(u.uFade, s.fade);
      gl.uniform1f(u.uFrame, s.frame);
      gl.uniform1f(u.uGrainPx, s.grainPx);
      gl.uniform1f(u.uVignette, s.vignette);
      gl.uniform3fv(u.uLook, s.look);
      const rects = new Float32Array(12), ks = new Float32Array(3);
      (s.scrims || []).slice(0, 3).forEach((sc, i) => {
        const [x0, y0, x1, y1] = sc.rect; // design px, y down
        rects.set([x0 / 1920, 1 - y1 / 1080, x1 / 1920, 1 - y0 / 1080], i * 4);
        ks[i] = sc.k;
      });
      gl.uniform4fv(u['uScrim[0]'], rects);
      gl.uniform1fv(u['uScrimK[0]'], ks);
      const trects = new Float32Array(48), tas = new Float32Array(12);
      (s.textMasks || []).slice(0, 12).forEach((m, i) => {
        const [x0, y0, x1, y1] = m.rect;
        trects.set([x0 / 1920, 1 - y1 / 1080, x1 / 1920, 1 - y0 / 1080], i * 4);
        tas[i] = m.a;
      });
      gl.uniform4fv(u['uText[0]'], trects);
      gl.uniform1fv(u['uTextA[0]'], tas);
    });
  }

  // composite the 2D text layer (premultiplied) over the graded image in the same canvas,
  // so a screenshot can never pair a frame with a stale overlay
  overlay(ui) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.uiTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, ui);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this.pass(this.ovl, null, (u) => this.bindTex(0, this.uiTex, u.uUi));
    gl.disable(gl.BLEND);
  }

  async render(s, opts = {}) {
    await this.renderScene(s, opts);
    this.post(s);
    if (opts.ui) this.overlay(opts.ui);
    const gl = this.gl;
    gl.finish();
    const px = new Uint8Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  }
}
