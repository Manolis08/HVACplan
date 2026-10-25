import { CameraControls, GizmoHelper, GizmoViewport } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import CameraControlsImpl from 'camera-controls';
import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref, type RefObject } from 'react';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  GreaterDepth,
  MeshStandardMaterial,
  Object3D,
  OrthographicCamera,
  Vector3,
} from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import type { Scale } from '../lib/scale';
import type { Theme } from '../lib/theme';
import type { Part, Vec3 } from '../model/types';
import { layoutDims, type DimsMode } from './dimLayout';
import { bboxCorners, detectView, fitZoom, viewBasis, viewById, type ViewId } from './views';

// Το μοντέλο είναι Z-πάνω (όπως στο τεχνικό σχέδιο), άρα και η κάμερα.
Object3D.DEFAULT_UP.set(0, 0, 1);

const { ACTION } = CameraControlsImpl;

export interface ViewerApi {
  goTo: (view: ViewId) => void;
  fit: () => void;
}

interface ViewerProps {
  part: Part;
  scale: Scale;
  dimsMode: DimsMode;
  /** Κρυφές ακμές ως διακεκομμένες πάνω από το μοντέλο. */
  showHidden: boolean;
  /** Χρωματισμός εδρών ανάλογα με την όψη στην οποία κοιτούν. */
  colorMode: boolean;
  theme: Theme;
  onViewChange: (view: ViewId | null) => void;
  ref?: Ref<ViewerApi>;
}

function partMetrics(part: Part) {
  const { min, max } = part.bbox;
  const center = new Vector3((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
  const diag = Math.max(Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]), 1e-3);
  return { center, diag, distance: diag * 3 };
}

function fitMargin(width: number, height: number, mode: DimsMode) {
  if (mode === 'none') return 24;
  return Math.min(110, Math.max(64, 0.18 * Math.min(width, height)));
}

/** Χρώματα όψεων: κάτοψη (+Z) πράσινο, πρόσοψη (−Y) κόκκινο, πλάγια (−X) μπλε, υπόλοιπα κίτρινο. */
export const FACE_COLORS = { top: '#00aa00', front: '#ff0000', side: '#0000ff', other: '#ffff00' } as const;

/** Ουδέτερο χρώμα του μοντέλου όταν τα χρώματα όψεων είναι κλειστά. */
const PLAIN_COLOR = '#c7d3e0';

function reducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function faceColorKey(nx: number, ny: number, nz: number): keyof typeof FACE_COLORS {
  if (nz > 0.5) return 'top';
  if (ny < -0.5) return 'front';
  if (nx < -0.5) return 'side';
  return 'other';
}

function PartMesh({ part, showHidden, colorMode }: { part: Part; showHidden: boolean; colorMode: boolean }) {
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(part.triangles, 3));
    g.computeVertexNormals();
    // χρώμα ανά τρίγωνο από το κάθετό του (για τον χρωματισμό όψεων)
    const n = g.getAttribute('normal');
    const colors = new Float32Array(n.count * 3);
    const palette = Object.fromEntries(Object.entries(FACE_COLORS).map(([k, v]) => [k, new Color(v)])) as Record<string, Color>;
    for (let i = 0; i < n.count; i++) {
      const c = palette[faceColorKey(n.getX(i), n.getY(i), n.getZ(i))];
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new BufferAttribute(colors, 3));
    return g;
  }, [part]);
  // Παχιές γραμμές (σε pixel οθόνης), ευανάγνωστες και σε κινητό με υψηλή πυκνότητα.
  const edges = useMemo(() => {
    const g = new LineSegmentsGeometry();
    g.setPositions(part.edges);
    // transparent: στο ίδιο πέρασμα με τις (ημιδιαφανείς) κρυφές γραμμές, ώστε να ισχύει η σειρά
    // σχεδίασης: πρώτα οι κρυφές, μετά οι ορατές· όπου συμπίπτουν φαίνεται η συνεχής.
    const m = new LineMaterial({ color: 0x17212b, linewidth: 1.5, transparent: true });
    const l = new LineSegments2(g, m);
    l.renderOrder = 2;
    return l;
  }, [part]);
  // Κουτί που περικλείει το κομμάτι (για αρχεία): οι διαστάσεις μετρώνται πάνω του.
  const box = useMemo(() => {
    if (!part.showBox) return null;
    const [x0, y0, z0] = part.bbox.min;
    const [x1, y1, z1] = part.bbox.max;
    const c = [
      [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
      [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
    ];
    const order = [0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7];
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(order.flatMap((i) => c[i])), 3));
    return g;
  }, [part]);
  useEffect(
    () => () => {
      geometry.dispose();
      edges.geometry.dispose();
      edges.material.dispose();
      box?.dispose();
    },
    [geometry, edges, box],
  );
  // Ομαλή μετάβαση στα χρώματα όψεων: το χρώμα κάθε έδρας ανακατεύεται από το ουδέτερο
  // στο χρώμα όψης με έναν συντελεστή (0 → 1) που κινείται λίγο σε κάθε καρέ.
  const colorMix = useRef({ value: colorMode ? 1 : 0 });
  // Οι κρυφές γραμμές μένουν στη σκηνή όσο «ξεχτίζονται» μετά το κλείσιμο.
  const [hiddenLeaving, setHiddenLeaving] = useState(false);
  useEffect(() => {
    if (showHidden) setHiddenLeaving(true);
  }, [showHidden]);
  const material = useMemo(() => {
    const m = new MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.85,
      metalness: 0,
      side: DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uColorMix = colorMix.current;
      shader.uniforms.uPlain = { value: new Color(PLAIN_COLOR) };
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uColorMix;\nuniform vec3 uPlain;')
        .replace('#include <color_fragment>', 'diffuseColor.rgb = mix(uPlain, vColor.rgb, uColorMix);');
    };
    return m;
  }, []);
  useEffect(() => () => material.dispose(), [material]);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => invalidate(), [colorMode, invalidate]);
  useFrame((_, delta) => {
    const mix = colorMix.current;
    const target = colorMode ? 1 : 0;
    if (mix.value === target) return;
    if (reducedMotion()) {
      mix.value = target;
    } else {
      // εκθετική εξομάλυνση (~0,4 s για να φτάσει σχεδόν στο τέλος). Το βήμα χρόνου περιορίζεται,
      // γιατί με απόδοση «κατ' απαίτηση» το πρώτο καρέ μετά από αδράνεια έχει τεράστιο delta.
      const dt = Math.min(delta, 1 / 30);
      mix.value += (target - mix.value) * (1 - Math.exp(-dt * 10));
      if (Math.abs(target - mix.value) < 0.004) mix.value = target;
    }
    invalidate();
  });
  return (
    <group>
      <mesh geometry={geometry} material={material} />
      <primitive object={edges} />
      {(showHidden || hiddenLeaving) && (
        <HiddenEdges edges={part.edges} show={showHidden} onHidden={() => setHiddenLeaving(false)} />
      )}
      {box && (
        <lineSegments geometry={box}>
          <lineBasicMaterial color="#8d9cab" />
        </lineSegments>
      )}
    </group>
  );
}

/**
 * Κρυφές ακμές: οι ίδιες ακμές σχεδιάζονται ξανά, διακεκομμένες, ΜΟΝΟ όπου υπάρχει επιφάνεια
 * μπροστά τους (έλεγχος βάθους «μεγαλύτερο από» ανά pixel στην κάρτα γραφικών). Έτσι πιάνονται
 * και ακμές που κρύβονται πίσω από άλλο κομμάτι υλικού, όχι μόνο οι «πίσω» έδρες.
 */
/** Χτίσιμο των κρυφών γραμμών: κάθε ακμή «τραβιέται» σε SEGMENT_TIME, η μία μετά την άλλη, σε BUILD_TIME συνολικά. */
const BUILD_TIME = 1.5;
const SEGMENT_TIME = 0.35;

function HiddenEdges({ edges, show, onHidden }: { edges: Float32Array; show: boolean; onHidden: () => void }) {
  const camera = useThree((s) => s.camera) as OrthographicCamera;
  const invalidate = useThree((s) => s.invalidate);
  // 0 = καμία γραμμή, 1 = όλες· κρατιέται όταν αλλάζουν τα μέτρα, ώστε να μη ξαναχτίζονται.
  const progress = useRef(0);
  const applied = useRef<{ line: unknown; value: number }>({ line: null, value: -1 });
  const built = useMemo(() => {
    const g = new LineSegmentsGeometry();
    // Αντίγραφο: το setPositions κρατά τον ίδιο πίνακα, και η κίνηση τον αλλάζει. Χωρίς αντίγραφο
    // θα «μαζεύονταν» οι ακμές του ίδιου του σχήματος (και του φύλλου όψεων).
    g.setPositions(edges.slice());
    // Γαλάζιο με πλήρη αδιαφάνεια: ξεχωρίζει και πάνω στο γκρι μοντέλο και στο σκοτεινό φόντο.
    const m = new LineMaterial({
      color: 0x4488ff,
      linewidth: 1.6,
      dashed: true,
      transparent: true,
      opacity: 1,
      depthWrite: false,
    });
    m.depthFunc = GreaterDepth;
    const l = new LineSegments2(g, m);
    l.computeLineDistances();
    l.renderOrder = 1;
    // Αντίγραφα των πλήρων ακμών και αποστάσεων: από αυτά υπολογίζεται κάθε ενδιάμεσο καρέ.
    const pos = (g.getAttribute('instanceStart') as unknown as { data: { array: Float32Array; needsUpdate: boolean } }).data;
    const dist = (g.getAttribute('instanceDistanceStart') as unknown as { data: { array: Float32Array; needsUpdate: boolean } }).data;
    return { line: l, pos, dist, fullPos: pos.array.slice(), fullDist: dist.array.slice() };
  }, [edges]);
  const { line } = built;

  /** Δείχνει το κομμάτι κάθε ακμής που αντιστοιχεί στη συνολική πρόοδο t (0…1). */
  const apply = (t: number) => {
    const { pos, dist, fullPos, fullDist } = built;
    const n = fullPos.length / 6;
    const spread = BUILD_TIME - SEGMENT_TIME;
    const time = t * BUILD_TIME;
    for (let i = 0; i < n; i++) {
      const delay = n > 1 ? (i / (n - 1)) * spread : 0;
      const p = Math.min(1, Math.max(0, (time - delay) / SEGMENT_TIME));
      const o = i * 6;
      for (let k = 0; k < 3; k++) {
        const a = fullPos[o + k];
        pos.array[o + 3 + k] = a + (fullPos[o + 3 + k] - a) * p;
      }
      // και οι αποστάσεις, ώστε οι παύλες να μένουν ίδιες και να μην «τεντώνονται»
      dist.array[i * 2 + 1] = fullDist[i * 2] + (fullDist[i * 2 + 1] - fullDist[i * 2]) * p;
    }
    pos.needsUpdate = true;
    dist.needsUpdate = true;
    line.visible = t > 0;
  };
  useEffect(
    () => () => {
      line.geometry.dispose();
      line.material.dispose();
    },
    [line],
  );
  // Παύλες 4 px / κενό 4 px ανεξάρτητα από το zoom (ορθογραφική: 1 px = 1/zoom mm).
  useEffect(() => invalidate(), [show, invalidate]);
  useFrame((_, delta) => {
    const px = 1 / camera.zoom;
    line.material.dashSize = 4 * px;
    line.material.gapSize = 4 * px;

    const target = show ? 1 : 0;
    if (progress.current !== target) {
      if (reducedMotion()) progress.current = target;
      else {
        // περιορισμένο βήμα: μετά από αδράνεια το πρώτο delta είναι τεράστιο
        const step = Math.min(delta, 1 / 30) / BUILD_TIME;
        progress.current = target > progress.current ? Math.min(target, progress.current + step) : Math.max(target, progress.current - step);
      }
      invalidate();
    }
    if (applied.current.line !== line || applied.current.value !== progress.current) {
      apply(progress.current);
      applied.current = { line, value: progress.current };
    }
    if (!show && progress.current === 0) onHidden();
  });
  return <primitive object={line} />;
}

interface ControllerProps {
  part: Part;
  scale: Scale;
  dimsMode: DimsMode;
  apiRef: RefObject<ViewerApi | null>;
  overlayRef: RefObject<SVGGElement | null>;
  onViewChange: (view: ViewId | null) => void;
}

function SceneController({ part, scale, dimsMode, apiRef, overlayRef, onViewChange }: ControllerProps) {
  const camera = useThree((s) => s.camera) as OrthographicCamera;
  // Ο έλεγχος κάμερας (makeDefault) μπαίνει στο store μετά την πρώτη απόδοση.
  const controls = useThree((s) => s.controls) as unknown as CameraControlsImpl | null;
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const lightRef = useRef<DirectionalLight>(null);
  const metrics = useMemo(() => partMetrics(part), [part]);
  const corners = useMemo(() => bboxCorners(part.bbox), [part]);

  const state = useRef({
    reported: undefined as ViewId | null | undefined,
    pending: null as ViewId | null,
    lastSvg: '',
    initialised: false,
    labelMemory: new Map<string, number>(),
  });

  // Τοποθέτηση κάμερας: ίδια κατεύθυνση, κέντρο στο μοντέλο, zoom ώστε να χωρά.
  const place = (dir: Vector3, animate: boolean) => {
    const c = controls;
    if (!c) return;
    const { center, distance } = metrics;
    const d = dir.clone().normalize();
    c.normalizeRotations();
    void c.setLookAt(
      center.x + d.x * distance,
      center.y + d.y * distance,
      center.z + d.z * distance,
      center.x,
      center.y,
      center.z,
      animate,
    );
    const margin = fitMargin(size.width, size.height, dimsMode);
    void c.zoomTo(fitZoom(d, part.bbox, size.width, size.height, margin), animate);
  };

  const currentDir = () => {
    const c = controls!;
    const pos = c.getPosition(new Vector3(), true);
    const target = c.getTarget(new Vector3(), true);
    return pos.sub(target).normalize();
  };

  const placeRef = useRef(place);
  placeRef.current = place;

  useImperativeHandle(apiRef, () => ({
    goTo: (view) => {
      state.current.pending = view;
      if (state.current.reported !== view) {
        state.current.reported = view;
        onViewChange(view);
      }
      placeRef.current(viewBasis(viewById(view).dir).dir, true);
    },
    fit: () => {
      if (controls) placeRef.current(currentDir(), true);
    },
  }));

  // Κοντινό/μακρινό επίπεδο κάμερας ανάλογα με το μέγεθος του κομματιού.
  useEffect(() => {
    camera.near = Math.max(0.01, metrics.distance - metrics.diag * 1.5);
    camera.far = metrics.distance + metrics.diag * 1.5;
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, metrics, invalidate]);

  // Αρχική ισομετρική χωρίς κίνηση· μετά, σε αλλαγή μεγέθους κομματιού ή παραθύρου,
  // ξαναχωράει το μοντέλο κρατώντας την τρέχουσα όψη.
  const bboxKey = `${part.bbox.min.join()}|${part.bbox.max.join()}`;
  useEffect(() => {
    if (!controls) return;
    const s = state.current;
    if (!s.initialised) {
      s.initialised = true;
      placeRef.current(viewBasis(viewById('iso').dir).dir, false);
    } else {
      placeRef.current(currentDir(), true);
    }
  }, [controls, bboxKey, size.width, size.height]);

  useEffect(() => {
    const c = controls;
    if (!c) return;
    c.mouseButtons.left = ACTION.ROTATE;
    c.mouseButtons.middle = ACTION.ZOOM;
    c.mouseButtons.right = ACTION.TRUCK;
    c.mouseButtons.wheel = ACTION.ZOOM;
    c.touches.one = ACTION.TOUCH_ROTATE;
    c.touches.two = ACTION.TOUCH_ZOOM_TRUCK;
    c.touches.three = ACTION.TOUCH_TRUCK;
    c.dollyToCursor = true;
    c.smoothTime = 0.3;
    c.draggingSmoothTime = 0.06;
    c.minZoom = 1e-4;
    c.maxZoom = 1e5;
    const onUserStart = () => {
      state.current.pending = null;
    };
    c.addEventListener('controlstart', onUserStart);
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__opseisDebug = { camera, controls: c };
    return () => c.removeEventListener('controlstart', onUserStart);
  }, [controls, camera]);

  useEffect(() => {
    state.current.lastSvg = '\u0000'; // αναγκαστικός επανυπολογισμός διαστάσεων
    invalidate();
  }, [scale, dimsMode, part, invalidate]);

  // Σχεδίαση μόνο όταν χρειάζεται: όταν η σελίδα ξαναγίνεται ορατή (επιστροφή από άλλη
  // εφαρμογή/καρτέλα), ζητάμε νέο καρέ, γιατί ο browser μπορεί να έχει καθαρίσει τον καμβά.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      state.current.lastSvg = '\u0000';
      invalidate();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onVisible);
    };
  }, [invalidate]);

  const tmp = useMemo(() => ({ v: new Vector3(), dir: new Vector3(), right: new Vector3(), target: new Vector3() }), []);

  useFrame(() => {
    const c = controls;
    if (!c) return;
    camera.updateMatrixWorld();

    // Φωτισμός από τη θέση της κάμερας, ώστε κάθε όψη να φωτίζεται ομοιόμορφα.
    c.getTarget(tmp.target, false);
    tmp.dir.copy(camera.position).sub(tmp.target).normalize();
    const light = lightRef.current;
    if (light) {
      light.position.copy(tmp.target).addScaledVector(tmp.dir, metrics.distance);
      light.position.addScaledVector(camera.up, metrics.diag * 0.6);
      light.target.position.copy(tmp.target);
      light.target.updateMatrixWorld();
    }

    // Ένδειξη όψης
    tmp.right.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    const detected = detectView(tmp.dir, tmp.right);
    const s = state.current;
    let shown: ViewId | null = detected;
    if (s.pending) {
      if (detected === s.pending) s.pending = null;
      else shown = s.pending;
    }
    if (shown !== s.reported) {
      s.reported = shown;
      onViewChange(shown);
    }

    // Διαστάσεις (2D επικάλυψη σε pixel οθόνης)
    const project = (p: Vec3): [number, number] => {
      tmp.v.set(p[0], p[1], p[2]).project(camera);
      return [((tmp.v.x + 1) / 2) * size.width, ((1 - tmp.v.y) / 2) * size.height];
    };
    const svg = layoutDims({
      dims: part.dims,
      project,
      viewDir: [tmp.dir.x, tmp.dir.y, tmp.dir.z],
      corners,
      scale,
      mode: dimsMode,
      memory: s.labelMemory,
    });
    if (svg !== s.lastSvg && overlayRef.current) {
      overlayRef.current.innerHTML = svg;
      s.lastSvg = svg;
    }
  });

  return (
    <>
      <hemisphereLight args={['#ffffff', '#8a97a6', 1.4]} />
      <directionalLight ref={lightRef} intensity={1.6} />
    </>
  );
}

export function Viewer({ part, scale, dimsMode, showHidden, colorMode, theme, onViewChange, ref }: ViewerProps) {
  const apiRef = useRef<ViewerApi | null>(null);
  const overlayRef = useRef<SVGGElement | null>(null);

  useImperativeHandle(ref, () => ({
    goTo: (view) => apiRef.current?.goTo(view),
    fit: () => apiRef.current?.fit(),
  }));

  return (
    <div className="viewer-canvas">
      <Canvas
        orthographic
        frameloop="demand"
        dpr={[1, 2]}
        camera={{ position: [300, -300, 300], zoom: 4, near: 0.1, far: 10000 }}
        gl={{ antialias: true }}
      >
        <color attach="background" args={[theme === 'dark' ? '#141c24' : '#f4f6f8']} />
        <CameraControls makeDefault />
        <PartMesh part={part} showHidden={showHidden} colorMode={colorMode} />
        <SceneController
          part={part}
          scale={scale}
          dimsMode={dimsMode}
          apiRef={apiRef}
          overlayRef={overlayRef}
          onViewChange={onViewChange}
        />
        <GizmoHelper alignment="top-left" margin={[40, 84]}>
          <GizmoViewport
            disabled
            scale={30}
            axisColors={['#d1453b', '#2f9e44', '#2b6cd4']}
            labelColor="#ffffff"
          />
        </GizmoHelper>
      </Canvas>
      <svg className="dims-overlay" aria-hidden="true">
        <g ref={overlayRef} />
      </svg>
    </div>
  );
}
