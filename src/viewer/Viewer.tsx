import { CameraControls, GizmoHelper, GizmoViewport } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import CameraControlsImpl from 'camera-controls';
import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref, type RefObject } from 'react';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  GreaterDepth,
  Group,
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

/** Εσωτερικό: και άμεση προσαρμογή της κάμερας στο τρέχον σχήμα (στη μέση της μετάβασης). */
interface SceneApi extends ViewerApi {
  snap: () => void;
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
  /**
   * Ταυτότητα του σχήματος και θέση του στη σειρά των έτοιμων σχημάτων (−1 για αρχείο).
   * Όταν αλλάζει σχήμα, το παλιό γλιστράει έξω και το νέο μπαίνει από την πλευρά της σειράς.
   */
  shape: { key: string; index: number };
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
  // σε μικρή προβολή (π.χ. κινητό οριζόντια) μικρότερο περιθώριο, αλλιώς το σχήμα γίνεται μικροσκοπικό
  const m = Math.min(width, height);
  return Math.min(110, Math.max(m < 360 ? 40 : 64, 0.18 * m));
}

/** Χρώματα όψεων: κάτοψη (+Z) πράσινο, πρόσοψη (−Y) κόκκινο, πλάγια (−X) μπλε, υπόλοιπα κίτρινο. */
export const FACE_COLORS = { top: '#00aa00', front: '#ff0000', side: '#0000ff', other: '#ffff00' } as const;

/** Διάρκεια της «υγρής μπογιάς» των χρωμάτων όψεων (s). */
const PAINT_TIME = 1;

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
  // Χρώματα όψεων με «υγρή μπογιά»: η μπογιά ανεβαίνει από κάτω προς τα πάνω με κυματιστό,
  // ρευστό μέτωπο (θόρυβος που κινείται) και απαλή διαβάθμιση, και καλύπτει όλο το σχήμα σε PAINT_TIME.
  // Στο κλείσιμο «αδειάζει» με τον ίδιο τρόπο. colorMix: 0 = καθόλου μπογιά, 1 = παντού.
  const colorMix = useRef({ value: colorMode ? 1 : 0 });
  const paintTime = useRef({ value: 0 });
  const paintBox = useRef({ min: { value: new Vector3() }, size: { value: new Vector3(1, 1, 1) } });
  {
    const { min, max } = part.bbox;
    paintBox.current.min.value.set(min[0], min[1], min[2]);
    paintBox.current.size.value.set(
      Math.max(max[0] - min[0], 1e-3),
      Math.max(max[1] - min[1], 1e-3),
      Math.max(max[2] - min[2], 1e-3),
    );
  }
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
      shader.uniforms.uPaintTime = paintTime.current;
      shader.uniforms.uBoxMin = paintBox.current.min;
      shader.uniforms.uBoxSize = paintBox.current.size;
      shader.uniforms.uPlain = { value: new Color(PLAIN_COLOR) };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vPaintPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPaintPos = transformed;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
uniform float uColorMix;
uniform float uPaintTime;
uniform vec3 uBoxMin;
uniform vec3 uBoxSize;
uniform vec3 uPlain;
varying vec3 vPaintPos;
float paintHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float paintNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(paintHash(i), paintHash(i + vec3(1, 0, 0)), f.x),
                 mix(paintHash(i + vec3(0, 1, 0)), paintHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(paintHash(i + vec3(0, 0, 1)), paintHash(i + vec3(1, 0, 1)), f.x),
                 mix(paintHash(i + vec3(0, 1, 1)), paintHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}`)
        .replace('#include <color_fragment>', `
vec3 q = (vPaintPos - uBoxMin) / uBoxSize;
// ύψος της μπογιάς: κυρίως από κάτω προς τα πάνω, λίγο λοξά για πιο ζωντανό μέτωπο
float coord = q.z * 0.72 + q.x * 0.18 + q.y * 0.10;
// ρευστό, κυματιστό μέτωπο: δύο κλίμακες θορύβου που κυλούν με τον χρόνο
float n = paintNoise(q * 3.0 + vec3(0.0, 0.0, -uPaintTime * 1.6)) * 0.65
        + paintNoise(q * 7.0 + vec3(uPaintTime * 0.9, 0.0, 0.0)) * 0.35 - 0.5;
const float AMP = 0.22;
const float BAND = 0.07;
float e = uColorMix * uColorMix * (3.0 - 2.0 * uColorMix);
float front = mix(-BAND - AMP, 1.0 + BAND + AMP, e);
float cover = 1.0 - smoothstep(front - BAND, front + BAND, coord + n * AMP);
diffuseColor.rgb = mix(uPlain, vColor.rgb, cover);
// «υγρή» λάμψη στο μέτωπο
diffuseColor.rgb += cover * (1.0 - cover) * 0.7;`);
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
      // σταθερός ρυθμός: όλη η κάλυψη σε PAINT_TIME (το βήμα περιορίζεται μετά από αδράνεια)
      const dt = Math.min(delta, 1 / 30);
      const step = dt / PAINT_TIME;
      mix.value = target > mix.value ? Math.min(target, mix.value + step) : Math.max(target, mix.value - step);
      paintTime.current.value += dt;
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
 * Μετάβαση από σχήμα σε σχήμα σε δύο φάσεις: πρώτα φεύγει το παλιό με την κάμερά του, μετά η κάμερα
 * προσαρμόζεται αμέσως στο νέο (εκτός οθόνης, δεν φαίνεται) και μπαίνει το νέο. Έτσι ένα μεγάλο σχήμα
 * δεν «φουσκώνει» ούτε κόβεται όταν η κάμερα κάνει zoom για ένα μικρότερο.
 */
const SLIDE_OUT = 0.32;
const SLIDE_IN = 0.38;
const easeIn = (t: number) => t * t;
const easeOut = (t: number) => 1 - (1 - t) ** 3;

interface SlidingProps {
  part: Part;
  shape: { key: string; index: number };
  showHidden: boolean;
  colorMode: boolean;
  /** true όσο διαρκεί η μετάβαση: η σκηνή δεν αλλάζει κάμερα μόνη της. */
  slidingRef: RefObject<boolean>;
  apiRef: RefObject<SceneApi | null>;
  onSlidingChange: (sliding: boolean) => void;
}

/**
 * Το τρέχον σχήμα, και όσο διαρκεί η μετάβαση και το προηγούμενο. Μετακινούνται κατά μήκος του
 * «δεξιά» της κάμερας: προς τα εμπρός στη σειρά το νέο έρχεται από δεξιά και το παλιό φεύγει αριστερά.
 */
function SlidingParts({ part, shape, showHidden, colorMode, slidingRef, apiRef, onSlidingChange }: SlidingProps) {
  const camera = useThree((s) => s.camera) as OrthographicCamera;
  const invalidate = useThree((s) => s.invalidate);
  const inRef = useRef<Group>(null);
  const outRef = useRef<Group>(null);
  const last = useRef({ part, shape });
  // phase: 'out' = φεύγει το παλιό, 'in' = μπαίνει το νέο, null = ακίνητα
  const anim = useRef<{ phase: 'out' | 'in' | null; t: number; dir: number }>({ phase: null, t: 0, dir: 0 });
  const [outgoing, setOutgoing] = useState<{ part: Part; id: number } | null>(null);
  const tmp = useMemo(() => new Vector3(), []);

  /** Μετατόπιση κατά k πλάτη οθόνης προς τα «δεξιά» της κάμερας (θετικό = δεξιά για dir = 1). */
  const shift = (g: Group | null, k: number) => {
    if (!g) return;
    const w = ((camera.right - camera.left) / camera.zoom) * anim.current.dir;
    tmp.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    g.position.copy(tmp).multiplyScalar(k * w);
  };
  const hideIncoming = (hidden: boolean) => {
    if (inRef.current) inRef.current.visible = !hidden;
  };

  // Πριν ζωγραφιστεί το νέο σχήμα: το βάζουμε ήδη έξω από την οθόνη, ώστε να μην «αναβοσβήσει».
  useLayoutEffect(() => {
    const prev = last.current;
    last.current = { part, shape };
    if (prev.shape.key === shape.key) return;
    const dir = prev.shape.index < 0 || shape.index < 0 ? 0 : Math.sign(shape.index - prev.shape.index);
    if (!dir || reducedMotion()) return;
    // ήδη φεύγει ένα σχήμα (γρήγορα διαδοχικά κλικ): συνεχίζει να φεύγει, απλώς θα μπει το νεότερο
    if (anim.current.phase === 'out') {
      hideIncoming(true);
      return;
    }
    anim.current = { phase: 'out', t: 0, dir };
    slidingRef.current = true;
    setOutgoing({ part: prev.part, id: Date.now() });
    onSlidingChange(true);
    hideIncoming(true);
    invalidate();
  }, [part, shape.key]); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame((_, delta) => {
    const a = anim.current;
    if (!a.phase) return;
    const dt = Math.min(delta, 1 / 30);
    if (a.phase === 'out') {
      a.t = Math.min(1, a.t + dt / SLIDE_OUT);
      shift(outRef.current, -easeIn(a.t));
      if (a.t >= 1) {
        // το παλιό βγήκε: κάμερα αμέσως στο νέο σχήμα, το νέο ξεκινά από την άλλη πλευρά
        setOutgoing(null);
        apiRef.current?.snap();
        camera.updateMatrixWorld();
        a.phase = 'in';
        a.t = 0;
        shift(inRef.current, 1);
        hideIncoming(false);
      }
    } else {
      a.t = Math.min(1, a.t + dt / SLIDE_IN);
      shift(inRef.current, 1 - easeOut(a.t));
      if (a.t >= 1) {
        inRef.current?.position.set(0, 0, 0);
        a.phase = null;
        slidingRef.current = false;
        onSlidingChange(false);
      }
    }
    invalidate();
  });

  return (
    <>
      <group ref={inRef}>
        <PartMesh part={part} showHidden={showHidden} colorMode={colorMode} />
      </group>
      {outgoing && (
        <group ref={outRef} key={outgoing.id}>
          <PartMesh part={outgoing.part} showHidden={showHidden} colorMode={colorMode} />
        </group>
      )}
    </>
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
    // Φάση παύλας από τη θέση στον χώρο (προβολή πάνω στη διεύθυνση της ακμής), όχι από το συνολικό
    // μήκος: ακμές που πέφτουν η μία πάνω στην άλλη στην οθόνη (π.χ. μπρος και πίσω τοίχωμα εγκοπής
    // σε κύρια όψη) έχουν τις παύλες στο ίδιο σημείο, αλλιώς η μία γέμιζε τα κενά της άλλης και
    // η γραμμή έδειχνε συνεχής.
    const fullPos = pos.array.slice();
    const fullDist = new Float32Array(dist.array.length);
    for (let i = 0; i < fullPos.length / 6; i++) {
      const o = i * 6;
      let dx = fullPos[o + 3] - fullPos[o];
      let dy = fullPos[o + 4] - fullPos[o + 1];
      let dz = fullPos[o + 5] - fullPos[o + 2];
      const len = Math.hypot(dx, dy, dz) || 1;
      dx /= len;
      dy /= len;
      dz /= len;
      // ίδια φορά για παράλληλες ακμές, όποια κι αν είναι η σειρά των άκρων τους
      const e = 1e-6;
      if (dx < -e || (Math.abs(dx) <= e && (dy < -e || (Math.abs(dy) <= e && dz < 0)))) {
        dx = -dx;
        dy = -dy;
        dz = -dz;
      }
      fullDist[i * 2] = fullPos[o] * dx + fullPos[o + 1] * dy + fullPos[o + 2] * dz;
      fullDist[i * 2 + 1] = fullPos[o + 3] * dx + fullPos[o + 4] * dy + fullPos[o + 5] * dz;
    }
    dist.array.set(fullDist);
    dist.needsUpdate = true;
    return { line: l, pos, dist, fullPos, fullDist };
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
  apiRef: RefObject<SceneApi | null>;
  slidingRef: RefObject<boolean>;
  overlayRef: RefObject<SVGGElement | null>;
  onViewChange: (view: ViewId | null) => void;
}

function SceneController({ part, scale, dimsMode, apiRef, slidingRef, overlayRef, onViewChange }: ControllerProps) {
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
    snap: () => {
      applyClipRef.current();
      if (controls) placeRef.current(currentDir(), false);
    },
  }));

  // Κοντινό/μακρινό επίπεδο κάμερας ανάλογα με το μέγεθος του κομματιού. Στη μετάβαση εφαρμόζεται
  // στο snap, αλλιώς το προηγούμενο (ίσως μεγαλύτερο) σχήμα θα κοβόταν όσο φεύγει.
  const applyClip = () => {
    camera.near = Math.max(0.01, metrics.distance - metrics.diag * 1.5);
    camera.far = metrics.distance + metrics.diag * 1.5;
    camera.updateProjectionMatrix();
    invalidate();
  };
  const applyClipRef = useRef(applyClip);
  applyClipRef.current = applyClip;
  useEffect(() => {
    if (!slidingRef.current) applyClipRef.current();
  }, [camera, metrics, slidingRef]);

  // Αρχική ισομετρική χωρίς κίνηση· μετά, σε αλλαγή μεγέθους κομματιού ή παραθύρου,
  // ξαναχωράει το μοντέλο κρατώντας την τρέχουσα όψη.
  const bboxKey = `${part.bbox.min.join()}|${part.bbox.max.join()}`;
  useEffect(() => {
    if (!controls) return;
    const s = state.current;
    if (!s.initialised) {
      s.initialised = true;
      placeRef.current(viewBasis(viewById('iso').dir).dir, false);
    } else if (!slidingRef.current) {
      // (στη μετάβαση η κάμερα προσαρμόζεται στο snap)
      placeRef.current(currentDir(), true);
    }
  }, [controls, bboxKey, size.width, size.height, slidingRef]);

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

export function Viewer({ part, scale, dimsMode, showHidden, colorMode, theme, shape, onViewChange, ref }: ViewerProps) {
  const apiRef = useRef<SceneApi | null>(null);
  const slidingRef = useRef(false);
  // Όσο γλιστράνε τα σχήματα, οι διαστάσεις κρύβονται (θα έδειχναν στη λάθος θέση).
  const [sliding, setSliding] = useState(false);
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
        <SlidingParts
          part={part}
          shape={shape}
          showHidden={showHidden}
          colorMode={colorMode}
          slidingRef={slidingRef}
          apiRef={apiRef}
          onSlidingChange={setSliding}
        />
        <SceneController
          part={part}
          scale={scale}
          dimsMode={dimsMode}
          apiRef={apiRef}
          slidingRef={slidingRef}
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
      <svg className={`dims-overlay${sliding ? ' sliding' : ''}`} aria-hidden="true">
        <g ref={overlayRef} />
      </svg>
    </div>
  );
}
