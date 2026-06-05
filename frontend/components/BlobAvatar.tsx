'use client';
import { useRef, useMemo , useEffect  , useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { MathUtils } from 'three'; 
export type BlobState = 'idle' | 'thinking' | 'using_tools' | 'talking';

const STATE_CONFIG: Record<
  BlobState,
  { colorStart: string; colorEnd: string; speed: number; intensity: number }
> = {
  idle: {
    colorStart: '#1e3a8a',
    colorEnd: '#3b82f6',
    speed: 0.3,
    intensity: 0.2,
  },
  thinking: {
    colorStart: '#a855f7',
    colorEnd: '#3b82f6',
    speed: 0.6,
    intensity: 0.35,
  },
  using_tools: {
    colorStart: '#f97316',
    colorEnd: '#eab308',
    speed: 0.8,
    intensity: 0.4,
  },
  talking: {
    colorStart: '#86efac',
    colorEnd: '#3b82f6',
    speed: 1.0,
    intensity: 0.4,
  },
};

// ── Audio: module-level (never resets on re‑render) ──────────────────────────
const audioState = {
  ctx: null as AudioContext | null,
  initBuf: null as AudioBuffer | null,
  transBuf: null as AudioBuffer | null,
  unlocked: false,
  initRaw: null as ArrayBuffer | null,
  transRaw: null as ArrayBuffer | null,
};

function getCtx(): AudioContext {
  if (!audioState.ctx) {
    audioState.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  return audioState.ctx;
}

function playBuf(buf: AudioBuffer, vol = 0.35) {
  const ctx = getCtx();
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const gain = ctx.createGain();
  gain.gain.value = vol;
  src.connect(gain);
  gain.connect(ctx.destination);
  src.start(0);
}

// ── Shaders ────────────────────────────────────────────────────────────────────
const vertexShader = `
  uniform float u_intensity;
  uniform float u_time;
  varying vec2 vUv;
  varying float vDisplacement;

  vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x,289.0);}
  vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
  vec3 fade(vec3 t){return t*t*t*(t*(t*6.0-15.0)+10.0);}

  float cnoise(vec3 P){
    vec3 Pi0=floor(P);vec3 Pi1=Pi0+vec3(1.0);
    Pi0=mod(Pi0,289.0);Pi1=mod(Pi1,289.0);
    vec3 Pf0=fract(P);vec3 Pf1=Pf0-vec3(1.0);
    vec4 ix=vec4(Pi0.x,Pi1.x,Pi0.x,Pi1.x);
    vec4 iy=vec4(Pi0.yy,Pi1.yy);
    vec4 iz0=Pi0.zzzz;vec4 iz1=Pi1.zzzz;
    vec4 ixy=permute(permute(ix)+iy);
    vec4 ixy0=permute(ixy+iz0);vec4 ixy1=permute(ixy+iz1);
    vec4 gx0=ixy0/7.0;vec4 gy0=fract(floor(gx0)/7.0)-0.5;
    gx0=fract(gx0);
    vec4 gz0=vec4(0.5)-abs(gx0)-abs(gy0);
    vec4 sz0=step(gz0,vec4(0.0));
    gx0-=sz0*(step(0.0,gx0)-0.5);gy0-=sz0*(step(0.0,gy0)-0.5);
    vec4 gx1=ixy1/7.0;vec4 gy1=fract(floor(gx1)/7.0)-0.5;
    gx1=fract(gx1);
    vec4 gz1=vec4(0.5)-abs(gx1)-abs(gy1);
    vec4 sz1=step(gz1,vec4(0.0));
    gx1-=sz1*(step(0.0,gx1)-0.5);gy1-=sz1*(step(0.0,gy1)-0.5);
    vec3 g000=vec3(gx0.x,gy0.x,gz0.x);vec3 g100=vec3(gx0.y,gy0.y,gz0.y);
    vec3 g010=vec3(gx0.z,gy0.z,gz0.z);vec3 g110=vec3(gx0.w,gy0.w,gz0.w);
    vec3 g001=vec3(gx1.x,gy1.x,gz1.x);vec3 g101=vec3(gx1.y,gy1.y,gz1.y);
    vec3 g011=vec3(gx1.z,gy1.z,gz1.z);vec3 g111=vec3(gx1.w,gy1.w,gz1.w);
    vec4 norm0=taylorInvSqrt(vec4(dot(g000,g000),dot(g010,g010),dot(g100,g100),dot(g110,g110)));
    g000*=norm0.x;g010*=norm0.y;g100*=norm0.z;g110*=norm0.w;
    vec4 norm1=taylorInvSqrt(vec4(dot(g001,g001),dot(g011,g011),dot(g101,g101),dot(g111,g111)));
    g001*=norm1.x;g011*=norm1.y;g101*=norm1.z;g111*=norm1.w;
    float n000=dot(g000,Pf0);float n100=dot(g100,vec3(Pf1.x,Pf0.yz));
    float n010=dot(g010,vec3(Pf0.x,Pf1.y,Pf0.z));float n110=dot(g110,vec3(Pf1.xy,Pf0.z));
    float n001=dot(g001,vec3(Pf0.xy,Pf1.z));float n101=dot(g101,vec3(Pf1.x,Pf0.y,Pf1.z));
    float n011=dot(g011,vec3(Pf0.x,Pf1.yz));float n111=dot(g111,Pf1);
    vec3 fade_xyz=fade(Pf0);
    vec4 n_z=mix(vec4(n000,n100,n010,n110),vec4(n001,n101,n011,n111),fade_xyz.z);
    vec2 n_yz=mix(n_z.xy,n_z.zw,fade_xyz.y);
    float n_xyz=mix(n_yz.x,n_yz.y,fade_xyz.x);
    return 2.2*n_xyz;
  }

  void main(){
    vUv=uv;
    vDisplacement=cnoise(position+vec3(2.0*u_time));
    vec3 newPosition=position+normal*(u_intensity*vDisplacement);
    vec4 modelPosition=modelMatrix*vec4(newPosition,1.0);
    vec4 viewPosition=viewMatrix*modelPosition;
    gl_Position=projectionMatrix*viewPosition;
  }
`;

const fragmentShader = `
  uniform float u_intensity;
  uniform float u_time;
  uniform vec3 uColorStart;
  uniform vec3 uColorEnd;
  varying vec2 vUv;
  varying float vDisplacement;

  void main(){
    float distort=2.0*vDisplacement*u_intensity*sin(vUv.y*10.0+u_time);
    float t=(abs(vUv.x-0.5)+abs(vUv.y-0.5));
    t*=(1.0-distort);
    vec3 color=mix(uColorStart,uColorEnd,t);
    gl_FragColor=vec4(color,1.0);
  }
`;

// ── Stars ──────────────────────────────────────────────────────────────────────
function Stars({ active }: { active: boolean }) {
  const starsRef = useRef<THREE.Points>(null);
  const count = 300;
  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const radius = 2.0 + Math.random() * 1.2;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      arr[i * 3]     = radius * Math.sin(phi) * Math.cos(theta);
      arr[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      arr[i * 3 + 2] = radius * Math.cos(phi);
    }
    return arr;
  }, []);

  useFrame((_, delta) => {
    if (!starsRef.current || !active) return;
    starsRef.current.rotation.y += delta * 0.3;
    starsRef.current.rotation.x = Math.sin(Date.now() * 0.0008) * 0.15;
  });

  if (!active) return null;
  return (
    <points ref={starsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" array={positions} count={count} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial color="#ffdd88" size={0.05} transparent opacity={0.8} blending={THREE.AdditiveBlending} />
    </points>
  );
}

// ── BlobMesh ───────────────────────────────────────────────────────────────────
function BlobMesh({
  state,
  breathing,
  entranceProgress,
}: {
  state: BlobState;
  breathing: boolean;
  entranceProgress: number;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const intensityRef = useRef(STATE_CONFIG[state].intensity);
  const targetRotation = useRef(new THREE.Euler(0, 0, 0));
  const previousState = useRef<BlobState>(state);

  if (state !== previousState.current) {
    targetRotation.current.set(
      (Math.random() - 0.5) * 0.2,
      Math.random() * Math.PI * 2,
      (Math.random() - 0.5) * 0.2,
    );
    previousState.current = state;
  }

  const uniforms = useMemo(() => ({
    u_time:      { value: 0 },
    u_intensity: { value: STATE_CONFIG[state].intensity },
    uColorStart: { value: new THREE.Color(STATE_CONFIG[state].colorStart) },
    uColorEnd:   { value: new THREE.Color(STATE_CONFIG[state].colorEnd) },
  }), []);

  useFrame((_, delta) => {
    if (!meshRef.current) return;

    intensityRef.current = MathUtils.lerp(intensityRef.current, STATE_CONFIG[state].intensity, 0.02);
    const mat = meshRef.current.material as THREE.ShaderMaterial;
    mat.uniforms.u_time.value      += delta * STATE_CONFIG[state].speed;
    mat.uniforms.u_intensity.value  = intensityRef.current;
    mat.uniforms.uColorStart.value.set(STATE_CONFIG[state].colorStart);
    mat.uniforms.uColorEnd.value.set(STATE_CONFIG[state].colorEnd);

    const rot = meshRef.current.rotation;
    rot.x += (targetRotation.current.x - rot.x) * 0.02;
    rot.y += (targetRotation.current.y - rot.y) * 0.02;
    rot.z += (targetRotation.current.z - rot.z) * 0.02;

    // Scale: entrance (lerp 0.6→1.0) → hold (1.0) → breathing (gentle oscillation)
    let scale = 1.0;
    if (entranceProgress < 1.0) {
      scale = 0.6 + (1.0 - 0.6) * entranceProgress;
    } else if (breathing) {
      scale = 1.0 + Math.sin(mat.uniforms.u_time.value * 3.0) * 0.02;
    }
    meshRef.current.scale.setScalar(scale);
  });

  return (
    <mesh ref={meshRef}>
      <icosahedronGeometry args={[1.2, 10]} />
      <shaderMaterial vertexShader={vertexShader} fragmentShader={fragmentShader} uniforms={uniforms} transparent />
    </mesh>
  );
}

// ── BlobAvatar ─────────────────────────────────────────────────────────────────
export function BlobAvatar({ state, size = 192 }: { state: BlobState; size?: number }) {
  const prevState = useRef<BlobState>(state);
  const [entranceProgress, setEntranceProgress] = useState(0);
  const [breathing, setBreathing] = useState(false);

  // ── Entrance animation (Three.js‑driven, 1.2s) ────────────────────────────────
  useEffect(() => {
    const start = performance.now();
    const duration = 1200;
    const animate = (now: number) => {
      const t = Math.min((now - start) / duration, 1.0);
      setEntranceProgress(1 - Math.pow(1 - t, 3)); // ease-out cubic
      if (t < 1) {
        requestAnimationFrame(animate);
      } else {
        setBreathing(true);
      }
    };
    requestAnimationFrame(animate);
  }, []);

  // ── Audio: pre‑fetch raw bytes ────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([
      fetch('/sounds/init.mp3').then(r => r.arrayBuffer()),
      fetch('/sounds/transition.mp3').then(r => r.arrayBuffer()),
    ]).then(([initRaw, transRaw]) => {
      audioState.initRaw  = initRaw;
      audioState.transRaw = transRaw;
    }).catch(() => {});
  }, []);

  // ── Audio: unlock on first user gesture + play init sound ─────────────────────
  useEffect(() => {
    const unlock = async (e: Event) => {
      if (audioState.unlocked) return;
      audioState.unlocked = true;
      e.preventDefault();
      e.stopPropagation();

      try {
        const ctx = getCtx();
        await ctx.resume();
        if (audioState.initRaw && !audioState.initBuf) {
          audioState.initBuf = await ctx.decodeAudioData(audioState.initRaw.slice(0));
        }
        if (audioState.transRaw && !audioState.transBuf) {
          audioState.transBuf = await ctx.decodeAudioData(audioState.transRaw.slice(0));
        }
        if (audioState.initBuf) playBuf(audioState.initBuf, 0.3);
      } catch (_) {}
    };

    const opts = { capture: true, once: true };
    document.addEventListener('click',      unlock, opts);
    document.addEventListener('keydown',    unlock, opts);
    document.addEventListener('touchstart', unlock, opts);
    document.addEventListener('pointerdown',unlock, opts);

    return () => {
      document.removeEventListener('click',      unlock, opts);
      document.removeEventListener('keydown',    unlock, opts);
      document.removeEventListener('touchstart', unlock, opts);
      document.removeEventListener('pointerdown',unlock, opts);
    };
  }, []);

  // ── Transition sound on state change ─────────────────────────────────────────
  useEffect(() => {
    if (prevState.current === state) return;
    prevState.current = state;
    if (audioState.unlocked && audioState.transBuf) {
      playBuf(audioState.transBuf, 0.2);
    }
  }, [state]);

  return (
    <div style={{ width: size, height: size }} className="relative mx-auto">
      <div
        className="absolute inset-0 rounded-full blur-3xl animate-pulse transition-colors duration-300"
        style={{
          background: `radial-gradient(circle, ${STATE_CONFIG[state].colorStart}30, transparent 80%)`,
        }}
      />
      <Canvas
  camera={{ position: [0, 0, 4.12], fov: 40 }}
  gl={{ antialias: true, alpha: true }}
  style={{ width: size, height: size }}
>
        <ambientLight intensity={0.3} />
        <pointLight position={[2, 2, 2]} intensity={1.0} />
        <pointLight position={[-2, -1, -2]} intensity={0.5} color="#ffaa66" />
        <Stars active={state === 'thinking'} />
        <BlobMesh state={state} />
      </Canvas>
    </div>
  );
}