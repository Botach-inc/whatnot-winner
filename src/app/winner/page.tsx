'use client';

import { useEffect, useRef } from 'react';

// ─── WebGL Chroma Key Shader ───
const VERTEX_SHADER = `
  attribute vec2 a_position;
  attribute vec2 a_texCoord;
  varying vec2 v_texCoord;
  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texCoord = a_texCoord;
  }
`;

const FRAGMENT_SHADER = `
  precision mediump float;
  varying vec2 v_texCoord;
  uniform sampler2D u_image;
  uniform vec3 u_keyColor;
  uniform float u_similarity;
  uniform float u_smoothness;

  void main() {
    vec4 color = texture2D(u_image, v_texCoord);
    // Calculate distance from key color in RGB space
    float diff = distance(color.rgb, u_keyColor);
    // Create alpha mask with smooth edge
    float alpha = smoothstep(u_similarity, u_similarity + u_smoothness, diff);
    // Suppress green spill on edges
    if (alpha > 0.0 && alpha < 1.0) {
      color.g = min(color.g, max(color.r, color.b) + 0.05);
    }
    gl_FragColor = vec4(color.rgb * alpha, alpha);
  }
`;

// ─── Confetti Config ───
const COLORS = [
  '#FFD700', '#FFA500', '#FF6347', '#FF4500',
  '#FFFFFF', '#FFE4B5', '#FF69B4', '#00BFFF',
  '#7CFC00', '#FF1493', '#FF8C00',
];

const W = 1080;
const H = 1920;
// Duration/fade are set dynamically from URL params in the component

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  color: string;
  size: number;
  rotation: number;
  rotSpeed: number;
  life: number;
  decay: number;
  gravity: number;
  wobble: number;
  wobbleSpeed: number;
  type: 'confetti' | 'spark' | 'star';
}

interface Ray {
  x: number; y: number;
  angle: number;
  length: number;
  width: number;
  color: string;
  life: number;
  decay: number;
}

function randomColor() {
  return COLORS[Math.floor(Math.random() * COLORS.length)];
}

function createParticle(x: number, y: number, vx: number, vy: number, type: Particle['type'] = 'confetti'): Particle {
  return {
    x, y, vx, vy,
    color: randomColor(),
    size: 8 + Math.random() * 14,
    rotation: Math.random() * Math.PI * 2,
    rotSpeed: (Math.random() - 0.5) * 0.3,
    life: 1,
    decay: 0.003 + Math.random() * 0.007,
    gravity: 0.15 + Math.random() * 0.1,
    wobble: Math.random() * Math.PI * 2,
    wobbleSpeed: 0.05 + Math.random() * 0.1,
    type,
  };
}

export default function WinnerPage() {
  const fxCanvasRef = useRef<HTMLCanvasElement>(null);
  const trumpCanvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const trumpWrapRef = useRef<HTMLDivElement>(null);
  const launchRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    // URL params for dynamic config (no redeploy needed):
    //   ?fade=15    → start fading visuals at 15s (default: 16, video is ~19s)
    //   ?duration=19 → total visual duration in seconds (default: 19)
    const params = new URLSearchParams(window.location.search);
    const DURATION = (parseFloat(params.get('duration') || '19')) * 1000;
    const FADE_AT = (parseFloat(params.get('fade') || '16')) * 1000;

    const fxCanvas = fxCanvasRef.current!;
    const trumpCanvas = trumpCanvasRef.current!;
    const video = videoRef.current!;
    const flash = flashRef.current!;
    const winnerText = textRef.current!;
    const trumpWrap = trumpWrapRef.current!;
    const ctx = fxCanvas.getContext('2d')!;

    // ─── Setup WebGL for chroma key ───
    const gl = trumpCanvas.getContext('webgl', { premultipliedAlpha: false, alpha: true })!;
    if (!gl) { console.error('No WebGL'); return; }

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    function compileShader(src: string, type: number) {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(shader));
      }
      return shader;
    }

    const program = gl.createProgram()!;
    gl.attachShader(program, compileShader(VERTEX_SHADER, gl.VERTEX_SHADER));
    gl.attachShader(program, compileShader(FRAGMENT_SHADER, gl.FRAGMENT_SHADER));
    gl.linkProgram(program);
    gl.useProgram(program);

    // Fullscreen quad
    const posBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    const posLoc = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    const texBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, texBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0,1, 1,1, 0,0, 1,0]), gl.STATIC_DRAW);
    const texLoc = gl.getAttribLocation(program, 'a_texCoord');
    gl.enableVertexAttribArray(texLoc);
    gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 0, 0);

    // Texture for video frames
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    // Set uniforms — green key color (pure green #00FF00 → 0, 1, 0)
    gl.uniform3f(gl.getUniformLocation(program, 'u_keyColor'), 0.0, 1.0, 0.0);
    gl.uniform1f(gl.getUniformLocation(program, 'u_similarity'), 0.35);
    gl.uniform1f(gl.getUniformLocation(program, 'u_smoothness'), 0.15);

    // ─── Particles ───
    let particles: Particle[] = [];
    let rays: Ray[] = [];
    let startTime = 0;
    let trumpPlaying = false;

    function spawnCenter() {
      const cx = W / 2, cy = H * 0.35;
      for (let i = 0; i < 200; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 8 + Math.random() * 22;
        const type: Particle['type'] = Math.random() < 0.15 ? 'star' : Math.random() < 0.3 ? 'spark' : 'confetti';
        particles.push(createParticle(cx, cy, Math.cos(angle) * speed, Math.sin(angle) * speed - 5, type));
      }
    }

    function spawnSides() {
      for (let i = 0; i < 80; i++) {
        const angle = -Math.PI / 4 + (Math.random() - 0.5) * Math.PI / 3;
        const speed = 10 + Math.random() * 15;
        particles.push(createParticle(0, H * 0.5, Math.cos(angle) * speed, Math.sin(angle) * speed - 8));
      }
      for (let i = 0; i < 80; i++) {
        const angle = Math.PI + Math.PI / 4 + (Math.random() - 0.5) * Math.PI / 3;
        const speed = 10 + Math.random() * 15;
        particles.push(createParticle(W, H * 0.5, Math.cos(angle) * speed, Math.sin(angle) * speed - 8));
      }
    }

    function spawnTop() {
      for (let i = 0; i < 120; i++) {
        particles.push(createParticle(Math.random() * W, -20, (Math.random() - 0.5) * 4, 2 + Math.random() * 6));
      }
    }

    function createRays() {
      rays = [];
      const cx = W / 2, cy = H * 0.35;
      for (let i = 0; i < 24; i++) {
        rays.push({
          x: cx, y: cy,
          angle: (i / 24) * Math.PI * 2,
          length: 200 + Math.random() * 400,
          width: 3 + Math.random() * 6,
          color: Math.random() < 0.5 ? '#FFD700' : '#FFA500',
          life: 1, decay: 0.012 + Math.random() * 0.008,
        });
      }
    }

    function drawStar(c: CanvasRenderingContext2D, cx: number, cy: number, outerR: number, innerR: number) {
      let rot = Math.PI / 2 * 3;
      const step = Math.PI / 5;
      c.beginPath();
      c.moveTo(cx, cy - outerR);
      for (let i = 0; i < 5; i++) {
        c.lineTo(cx + Math.cos(rot) * outerR, cy + Math.sin(rot) * outerR);
        rot += step;
        c.lineTo(cx + Math.cos(rot) * innerR, cy + Math.sin(rot) * innerR);
        rot += step;
      }
      c.closePath();
    }

    // ─── Animation ───
    function animate(timestamp: number) {
      if (!startTime) startTime = timestamp;
      const elapsed = timestamp - startTime;

      if (elapsed > DURATION) {
        // Clear visuals but let video audio play to completion
        ctx.clearRect(0, 0, W, H);
        winnerText.style.opacity = '0';
        winnerText.style.transform = 'scale(0)';
        trumpWrap.style.opacity = '0';
        trumpWrap.style.transform = 'translateX(-50%) scale(0)';
        gl.clear(gl.COLOR_BUFFER_BIT);
        return;
      }

      ctx.clearRect(0, 0, W, H);

      // Rays
      for (const r of rays) {
        if (r.life <= 0) continue;
        ctx.save();
        ctx.globalAlpha = r.life * 0.7;
        ctx.strokeStyle = r.color;
        ctx.shadowColor = r.color;
        ctx.shadowBlur = 20;
        ctx.lineWidth = r.width * r.life;
        ctx.beginPath();
        ctx.moveTo(r.x, r.y);
        ctx.lineTo(
          r.x + Math.cos(r.angle) * r.length * (1.5 - r.life),
          r.y + Math.sin(r.angle) * r.length * (1.5 - r.life),
        );
        ctx.stroke();
        ctx.restore();
        r.life -= r.decay;
      }

      // Particles
      for (const p of particles) {
        if (p.life <= 0) continue;
        p.vy += p.gravity;
        p.vx *= 0.985;
        p.vy *= 0.985;
        p.x += p.vx;
        p.y += p.vy;
        p.rotation += p.rotSpeed;
        p.wobble += p.wobbleSpeed;
        p.life -= p.decay;
        p.vx += Math.sin(p.wobble) * 0.3;

        ctx.save();
        ctx.globalAlpha = Math.min(p.life, 1);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        if (p.type === 'confetti') {
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size / 2, -p.size * 0.3, p.size, p.size * 0.6);
        } else if (p.type === 'spark') {
          ctx.fillStyle = p.color;
          ctx.shadowColor = p.color;
          ctx.shadowBlur = 8;
          ctx.beginPath();
          ctx.arc(0, 0, p.size * 0.4, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillStyle = p.color;
          ctx.shadowColor = p.color;
          ctx.shadowBlur = 12;
          drawStar(ctx, 0, 0, p.size, p.size * 0.5);
          ctx.fill();
        }
        ctx.restore();
      }
      particles = particles.filter(p => p.life > 0);

      // Sustained confetti
      if (elapsed > 500 && elapsed < 5000 && Math.random() < 0.3) {
        particles.push(createParticle(Math.random() * W, -10, (Math.random() - 0.5) * 3, 3 + Math.random() * 4));
      }
      if ((elapsed > 2000 && elapsed < 2050) || (elapsed > 4000 && elapsed < 4050)) {
        spawnCenter();
      }

      // Trump WebGL render
      if (trumpPlaying && !video.paused && !video.ended && video.readyState >= 2) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }

      // Text animation
      const textDelay = 400, textDur = 600;
      if (elapsed >= textDelay) {
        const t = Math.min((elapsed - textDelay) / textDur, 1);
        const p2 = 0.4, s = p2 / 4;
        const ease = t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t - s) * (2 * Math.PI) / p2) + 1;
        winnerText.style.opacity = String(Math.min(t * 2, 1));
        winnerText.style.transform = t >= 1
          ? `scale(${1 + Math.sin((elapsed - textDelay - textDur) * 0.005) * 0.03})`
          : `scale(${ease})`;
      }

      // Trump scale-in
      if (elapsed >= 200) {
        const t = Math.min((elapsed - 200) / 800, 1);
        const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        trumpWrap.style.opacity = String(Math.min(t * 3, 1));
        trumpWrap.style.transform = `translateX(-50%) scale(${ease})`;
      }

      // Fade out visuals starting at FADE_AT (configurable via ?fade= param)
      if (elapsed >= FADE_AT) {
        const fadeDuration = DURATION - FADE_AT;
        const alpha = 1 - (elapsed - FADE_AT) / fadeDuration;
        winnerText.style.opacity = String(Math.max(alpha, 0));
        trumpWrap.style.opacity = String(Math.max(alpha, 0));
      }

      requestAnimationFrame(animate);
    }

    // ─── Launch ───
    function launch() {
      startTime = 0;
      particles = [];
      trumpPlaying = false;

      // Flash
      flash.style.transition = 'none';
      flash.style.opacity = '0.9';
      requestAnimationFrame(() => {
        flash.style.transition = 'opacity 0.5s ease-out';
        flash.style.opacity = '0';
      });

      createRays();
      spawnCenter();
      setTimeout(spawnSides, 150);
      setTimeout(spawnTop, 300);

      // Play video — try unmuted first (works in OBS which bypasses autoplay policy).
      // Falls back to muted if browser blocks it.
      video.muted = false;
      video.currentTime = 0;
      video.play().then(() => {
        trumpPlaying = true;
      }).catch(() => {
        video.muted = true;
        video.play().then(() => { trumpPlaying = true; }).catch(() => {});
      });

      requestAnimationFrame(animate);
    }

    launchRef.current = launch;
    setTimeout(launch, 100);
  }, []);

  return (
    <div style={{ width: W, height: H, position: 'relative', overflow: 'hidden', background: 'transparent' }}>
      {/* Flash overlay */}
      <div ref={flashRef} style={{
        position: 'absolute', top: 0, left: 0, width: W, height: H,
        background: 'white', opacity: 0, zIndex: 5, pointerEvents: 'none',
      }} />

      {/* Confetti canvas */}
      <canvas ref={fxCanvasRef} width={W} height={H} style={{
        position: 'absolute', top: 0, left: 0, width: W, height: H, zIndex: 1,
      }} />

      {/* Winner text */}
      <div ref={textRef} style={{
        position: 'absolute', top: 120, left: 0, width: W, textAlign: 'center',
        zIndex: 10, opacity: 0, transform: 'scale(0)', pointerEvents: 'none',
        fontFamily: "'Arial Black', Impact, sans-serif",
      }}>
        <div style={{
          fontSize: 160, fontWeight: 900, color: '#FFD700', letterSpacing: 12,
          textShadow: '0 0 40px rgba(255,215,0,0.8), 0 0 80px rgba(255,165,0,0.6), 0 4px 0 #B8860B, 0 8px 0 #8B6914, 0 12px 20px rgba(0,0,0,0.5)',
          WebkitTextStroke: '2px #FFA500',
        }}>WINNER</div>
        <div style={{
          fontSize: 48, fontWeight: 700, color: 'white', letterSpacing: 8, marginTop: 10,
          textShadow: '0 0 20px rgba(255,215,0,0.6), 0 2px 0 #B8860B, 0 4px 10px rgba(0,0,0,0.4)',
        }}>CONGRATULATIONS</div>
      </div>

      {/* Trump container with WebGL chroma key canvas — 16:9 aspect ratio matching video */}
      <div ref={trumpWrapRef} style={{
        position: 'absolute', bottom: 200, left: '50%',
        transform: 'translateX(-50%) scale(0)',
        width: 800, height: 450, zIndex: 8, opacity: 0, pointerEvents: 'none',
      }}>
        {/* Gold glow behind Trump */}
        <div style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 700, height: 700, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(255,215,0,0.5) 0%, rgba(255,165,0,0.15) 50%, transparent 70%)',
          zIndex: -1,
        }} />
        <canvas ref={trumpCanvasRef} width={800} height={450} style={{
          display: 'block', width: 800, height: 450,
        }} />
      </div>

      {/* Hidden video element */}
      <video ref={videoRef} src="/trump-greenscreen.mp4" playsInline preload="auto"
        style={{ display: 'none' }} />
    </div>
  );
}
