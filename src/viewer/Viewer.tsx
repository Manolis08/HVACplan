import { CameraControls } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import CameraControlsImpl from 'camera-controls';
import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type Ref, type RefObject } from 'react';
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
  PMREMGenerator,
  Vector3,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { edgeTopology, silhouettes } from '../drawing/hlr';
import type { Scale } from '../lib/scale';
import { themeInfo, type Theme } from '../lib/theme';
import type { BBox, Part, Vec3 } from '../model/types';
import { layoutDims, type DimsMode, type DimStyle } from './dimLayout';
import { bboxCorners, detectView, fitZoom, viewBasis, viewById, VIEWS, type ViewId } from './views';

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

/** Η ετικέτα διάστασης με το δοσμένο id (αν υπάρχει) μεγαλώνει και αναβοσβήνει (CSS: dim-focus). */
function markFocus(g: SVGGElement | null, id: string | null) {
  g?.querySelectorAll(':scope > g.dim').forEach((el) => el.classList.toggle('dim-focus', !!id && el.getAttribute('data-dim') === id));
}

interface ViewerProps {
  part: Part;
  scale: Scale;
  dimsMode: DimsMode;
  /** Πυκνότητα των διαστάσεων στην οθόνη (προεπιλογή: κανονική). */
  dimStyle?: DimStyle;
  /** Ευρύτερο πλαίσιο για τα επίπεδα κοπής της κάμερας (π.χ. όλη η σκηνή όταν δείχνουμε ένα κομμάτι της). */
  clipBox?: BBox;
  /** Κρυφές ακμές ως διακεκομμένες πάνω από το μοντέλο. */
  showHidden: boolean;
  /** Χρωματισμός εδρών ανάλογα με την όψη στην οποία κοιτούν. */
  colorMode: boolean;
  /** Διάσταση που αλλάζει ο χρήστης τώρα: η ετικέτα της μεγαλώνει και αναβοσβήνει. */
  focusDim?: string | null;
  theme: Theme;
  /**
   * Ταυτότητα του σχήματος και θέση του στη σειρά των έτοιμων σχημάτων (−1 για αρχείο).
   * Όταν αλλάζει σχήμα, το παλιό γλιστράει έξω και το νέο μπαίνει από την πλευρά της σειράς.
   */
  shape: { key: string; index: number };
  onViewChange: (view: ViewId | null) => void;
  /**
   * Καλείται σε κάθε καρέ με την προβολή σημείου του μοντέλου σε pixel της προβολής, ώστε στοιχεία
   * του `overlay` να ακολουθούν το μοντέλο (π.χ. κουμπιά πάνω σε κομμάτια).
   */
  onFrame?: (project: Project, size: { width: number; height: number }) => void;
  /** Στοιχεία πάνω από την προβολή, που τα τοποθετεί το `onFrame`. Κρύβονται όσο γλιστράνε τα σχήματα. */
  overlay?: ReactNode;
  /** Κομμάτι που σέρνεται ελεύθερα πάνω από το κανονικό σχήμα. */
  floating?: FloatingPiece | null;
  /** Χωρίς το γλίστρημα όταν αλλάζει σχήμα: το νέο μπαίνει αμέσως (η καρτέλα κάνει δική της μετάβαση). */
  noSlide?: boolean;
  /** Μικρό περιθώριο στην αρχική όψη (π.χ. Τ+Π): το σχήμα γεμίζει περισσότερο την οθόνη. */
  tightFit?: boolean;
  /** Το κανονικό σχήμα (και οι διαστάσεις του) κρυμμένο, π.χ. όσο διαρκεί μια δική μας μετάβαση. */
  hidePart?: boolean;
  /** Κομμάτι με μεταβλητή διαφάνεια (0…1 από το opacityRef), που σβήνει ή εμφανίζεται. */
  ghost?: { part: Part; opacityRef: RefObject<number> } | null;
  /** Επιπλέον αντικείμενα μέσα στη σκηνή (π.χ. εργαλεία), που μπορούν να χρησιμοποιούν useFrame/useThree. */
  scene?: ReactNode;
  /** Σκούρο γκρι μεταλλικό υλικό (με δικό του φωτισμό περιβάλλοντος) αντί για το ουδέτερο. */
  metal?: boolean;
  ref?: Ref<ViewerApi>;
}

export type Project = (p: Vec3) => [number, number];

/** Θέση και περιστροφή (rx, ry, rz σε rad, σειρά ZYX) του σημείου λαβής ενός κομματιού που σέρνεται. */
export interface FloatPose {
  pos: Vec3;
  rot: Vec3;
}

/** Κομμάτι που κινείται ελεύθερα (π.χ. ragdoll): σχεδιάζεται ξεχωριστά και παίρνει τη στάση του από το poseRef σε κάθε καρέ. */
export interface FloatingPiece {
  part: Part;
  /** σημείο λαβής στις συντεταγμένες του κομματιού: γύρω από αυτό γυρίζει */
  pivot: Vec3;
  poseRef: RefObject<FloatPose>;
}

function partMetrics(part: Part, clipBox?: BBox) {
  const { min, max } = part.bbox;
  const center = new Vector3((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
  const own = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  // Το μέγεθος για τα επίπεδα κοπής μπορεί να είναι μεγαλύτερο από το κομμάτι: όσο η κάμερα πηγαίνει ομαλά
  // από ένα πλαίσιο σε άλλο, το μοντέλο δεν πρέπει να κόβεται (να «εξαφανίζεται») στο ενδιάμεσο.
  const wide = clipBox ? Math.hypot(clipBox.max[0] - clipBox.min[0], clipBox.max[1] - clipBox.min[1], clipBox.max[2] - clipBox.min[2]) : 0;
  const diag = Math.max(own, wide, 1e-3);
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

/** Γωνία μέσα στην οποία η περιστροφή «κουμπώνει» σε όψη όταν αφήνεις το ποντίκι/δάχτυλο (~10°). */
const SNAP_ANGLE = (10 * Math.PI) / 180;

/**
 * Οι διαστάσεις αλλάζουν με απαλό ξεθώριασμα (μόνο διαφάνεια), και μόνο όσες όντως εμφανίζονται ή φεύγουν: όταν
 * αλλάζεις από «Όλες» σε «Απαραίτητες», οι κοινές διαστάσεις μένουν ακίνητες. Χρόνος σβησίματος (ms)· ο ίδιος και στο
 * CSS (dim-fade-out).
 */
const DIMS_OUT_MS = 200;
/** χρόνος εμφάνισης (ms)· ο ίδιος και στο CSS (dim-fade-in) */
const DIMS_IN_MS = 240;

/** Διάρκεια της «υγρής μπογιάς» των χρωμάτων όψεων (s). */
const PAINT_TIME = 1;

/** Ουδέτερο χρώμα του μοντέλου όταν τα χρώματα όψεων είναι κλειστά. */
const PLAIN_COLOR = '#c7d3e0';

/** Σκούρο γκρι με λίγη μεταλλική λάμψη (π.χ. για τα Τ και Π, που είναι από χάλυβα). */
const METAL_COLOR = '#5a6068';

function reducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function faceColorKey(nx: number, ny: number, nz: number): keyof typeof FACE_COLORS {
  if (nz > 0.5) return 'top';
  if (ny < -0.5) return 'front';
  if (nx < -0.5) return 'side';
  return 'other';
}

interface PartMeshProps {
  part: Part;
  showHidden: boolean;
  colorMode: boolean;
  metal?: boolean;
  /** διαφάνεια 0…1 σε κάθε καρέ (για κομμάτια που σβήνουν/εμφανίζονται) */
  opacityRef?: RefObject<number>;
}

function PartMesh({ part, showHidden, colorMode, metal = false, opacityRef }: PartMeshProps) {
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
      transparent: !!opacityRef,
      roughness: metal ? 0.55 : 0.85,
      metalness: metal ? 0.45 : 0,
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
      shader.uniforms.uPlain = { value: new Color(metal ? METAL_COLOR : PLAIN_COLOR) };
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
vec3 q = clamp((vPaintPos - uBoxMin) / uBoxSize, 0.0, 1.0);
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
  }, [metal]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => material.dispose(), [material]);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => invalidate(), [colorMode, invalidate]);
  useFrame((_, delta) => {
    if (opacityRef) {
      const o = Math.min(1, Math.max(0, opacityRef.current));
      material.opacity = o;
      material.depthWrite = o > 0.98;
      edges.material.opacity = o;
      edges.visible = o > 0.01;
      invalidate(); // όσο υπάρχει, η διαφάνεια μπορεί να αλλάζει σε κάθε καρέ
    }
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
      <HiddenSilhouettes triangles={part.triangles} show={showHidden} />
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
const SLIDE_OUT = 0.4;
/** Σβούρα: μόλις αλλάξεις σχήμα, το παλιό αρχίζει να γυρίζει γύρω από τον κάθετο άξονά του (επιταχύνοντας). Όσο
 *  συνεχίζεις να αλλάζεις σχήμα, μένει στη θέση του και γυρίζει όλο και πιο γρήγορα, ανάλογα με το πόσο γρήγορα
 *  πατάς. Όταν σταματήσεις (IDLE_MS χωρίς νέα αλλαγή), φεύγει αριστερά πάντα γυρίζοντας, το τελευταίο σχήμα μπαίνει
 *  από δεξιά με την ίδια ταχύτητα, επιβραδύνει και κάθεται ακριβώς στην ισομετρική όψη. */
const BASE_OMEGA = 12; // rad/s: ταχύτητα σβούρας με ένα μόνο κλικ
const BOOST_PER_CLICK = 11; // rad/s που προστίθενται σε κάθε επιπλέον αλλαγή
const BOOST_DECAY = 1.4; // 1/s: πόσο γρήγορα «ξεχνά» τα κλικ όταν σταματήσεις να πατάς
const MAX_OMEGA = 60; // rad/s (~9,5 στροφές το δευτερόλεπτο)
const IDLE_MS = 280;
/** ελάχιστος χρόνος (s) επιβράδυνσης του νέου σχήματος ως την ισομετρική */
const SETTLE_MIN = 0.3;

/** Ταχύτητα στόχος της σβούρας (rad/s) για το τρέχον «κλικ boost». */
export const omegaTarget = (boost: number) => Math.min(MAX_OMEGA, BASE_OMEGA + boost);

/**
 * Επιβράδυνση του νέου σχήματος: σταθερή, ώστε να σταματήσει ακριβώς σε ακέραιο αριθμό στροφών (= ισομετρική
 * όψη), προχωρώντας D rad σε χρόνο T, με D τουλάχιστον όση απόσταση χρειάζεται για minTime δευτερόλεπτα.
 */
export function settlePlan(ang: number, omega: number, minTime: number) {
  const TWO_PI = 2 * Math.PI;
  const rem = (TWO_PI - (ang % TWO_PI)) % TWO_PI;
  const dMin = (omega * minTime) / 2;
  const D = rem + TWO_PI * Math.max(0, Math.ceil((dMin - rem) / TWO_PI));
  return { D, T: (2 * D) / omega };
}
const easeIn = (t: number) => t * t;
const easeOut = (t: number) => 1 - (1 - t) ** 3;

interface SlidingProps {
  part: Part;
  shape: { key: string; index: number };
  showHidden: boolean;
  colorMode: boolean;
  metal: boolean;
  noSlide: boolean;
  hidden: boolean;
  /** true όσο διαρκεί η μετάβαση: η σκηνή δεν αλλάζει κάμερα μόνη της. */
  slidingRef: RefObject<boolean>;
  apiRef: RefObject<SceneApi | null>;
  onSlidingChange: (sliding: boolean) => void;
}

/**
 * Το τρέχον σχήμα, και όσο διαρκεί η μετάβαση και το προηγούμενο. Μετακινούνται κατά μήκος του
 * «δεξιά» της κάμερας: προς τα εμπρός στη σειρά το νέο έρχεται από δεξιά και το παλιό φεύγει αριστερά.
 */
/** Κέντρο του κουτιού του κομματιού (ή το αντίθετό του, για k = −1): γύρω από αυτό γυρίζει η σβούρα. */
function bboxCenter(part: Part, k = 1): [number, number, number] {
  const { min, max } = part.bbox;
  return [k * (min[0] + max[0]) / 2, k * (min[1] + max[1]) / 2, k * (min[2] + max[2]) / 2];
}

function SlidingParts({ part, shape, showHidden, colorMode, metal, noSlide, hidden, slidingRef, apiRef, onSlidingChange }: SlidingProps) {
  const camera = useThree((s) => s.camera) as OrthographicCamera;
  const invalidate = useThree((s) => s.invalidate);
  const inRef = useRef<Group>(null);
  const outRef = useRef<Group>(null);
  const spinInRef = useRef<Group>(null);
  const spinOutRef = useRef<Group>(null);
  const last = useRef({ part, shape });
  // phase: 'spin' = το παλιό σχήμα γυρίζει στη θέση του (όσο συνεχίζονται οι αλλαγές), 'out' = φεύγει γυρίζοντας,
  // 'in' = μπαίνει το νέο και επιβραδύνει ως την ισομετρική, null = ακίνητα
  const sp = useRef({
    phase: null as 'spin' | 'out' | 'in' | null,
    /** χρόνος μέσα στη φάση (s) */
    t: 0,
    dir: 1,
    omega: 0,
    ang: 0,
    boost: 0,
    lastClick: 0,
    /** μετατόπιση (σε πλάτη οθόνης) του σχήματος που γυρίζει, που επιστρέφει στο κέντρο */
    off: 0,
    outIndex: 0,
    T: 0,
    ang0: 0,
    omega0: 0,
  });
  const [outgoing, setOutgoing] = useState<{ part: Part; id: number } | null>(null);
  const tmp = useMemo(() => new Vector3(), []);

  /** Μετατόπιση κατά k πλάτη οθόνης προς τα «δεξιά» της κάμερας (θετικό = δεξιά για dir = 1). */
  const shift = (g: Group | null, k: number) => {
    if (!g) return;
    const w = ((camera.right - camera.left) / camera.zoom) * sp.current.dir;
    tmp.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    g.position.copy(tmp).multiplyScalar(k * w);
  };
  const hideIncoming = (hidden: boolean) => {
    if (inRef.current) inRef.current.visible = !hidden;
  };
  const spinTo = (g: Group | null, ang: number) => {
    if (g) g.rotation.z = -ang;
  };

  // Πριν ζωγραφιστεί το νέο σχήμα: το βάζουμε ήδη έξω από την οθόνη, ώστε να μην «αναβοσβήσει».
  useLayoutEffect(() => {
    const prev = last.current;
    last.current = { part, shape };
    if (prev.shape.key === shape.key) return;
    const s = sp.current;
    if (s.phase === null && (prev.shape.index < 0 || shape.index < 0 || noSlide || reducedMotion())) return;
    s.lastClick = performance.now();
    if (s.phase === null) {
      s.phase = 'spin';
      s.t = 0;
      s.omega = 0;
      s.ang = 0;
      s.boost = 0;
      s.off = 0;
      s.dir = Math.sign(shape.index - prev.shape.index) || 1;
      s.outIndex = prev.shape.index;
      slidingRef.current = true;
      setOutgoing({ part: prev.part, id: Date.now() });
      onSlidingChange(true);
    } else {
      s.boost += BOOST_PER_CLICK;
      if (s.phase === 'out') {
        // ήδη έφευγε: επιστρέφει στο κέντρο και συνεχίζει να γυρίζει
        s.off = -easeIn(Math.min(1, s.t / SLIDE_OUT));
      } else if (s.phase === 'in') {
        // ήδη έμπαινε το (προηγούμενο) νέο σχήμα: γίνεται αυτό το σχήμα που γυρίζει
        s.off = 1 - easeOut(Math.min(1, s.t / s.T));
        setOutgoing({ part: prev.part, id: Date.now() });
        if (inRef.current) inRef.current.position.set(0, 0, 0);
        spinTo(spinInRef.current, 0);
      }
      s.phase = 'spin';
    }
    hideIncoming(true);
    invalidate();
  }, [part, shape.key]); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame((_, delta) => {
    const s = sp.current;
    if (!s.phase) return;
    const dt = Math.min(delta, 1 / 30);
    if (s.phase === 'spin') {
      s.boost *= Math.exp(-dt * BOOST_DECAY);
      const target = omegaTarget(s.boost);
      s.omega += (target - s.omega) * (1 - Math.exp(-dt * 9));
      s.ang += s.omega * dt;
      s.off -= s.off * (1 - Math.exp(-dt * 10));
      shift(outRef.current, s.off);
      spinTo(spinOutRef.current, s.ang);
      if (performance.now() - s.lastClick > IDLE_MS) {
        s.phase = 'out';
        s.t = 0;
        s.dir = Math.sign(last.current.shape.index - s.outIndex) || s.dir;
      }
    } else if (s.phase === 'out') {
      s.t += dt;
      const u = Math.min(1, s.t / SLIDE_OUT);
      s.ang += s.omega * dt;
      shift(outRef.current, -easeIn(u));
      spinTo(spinOutRef.current, s.ang);
      if (u >= 1) {
        // το παλιό βγήκε: κάμερα αμέσως στο νέο σχήμα, το νέο ξεκινά από την άλλη πλευρά, ήδη γυρίζοντας
        setOutgoing(null);
        apiRef.current?.snap();
        camera.updateMatrixWorld();
        // επιβράδυνση σταθερή, ώστε να σταματήσει ακριβώς σε ακέραιο αριθμό στροφών (= ισομετρική όψη)
        s.phase = 'in';
        s.t = 0;
        s.ang0 = s.ang;
        s.omega0 = s.omega;
        s.T = settlePlan(s.ang, s.omega, SETTLE_MIN).T;
        shift(inRef.current, 1);
        spinTo(spinInRef.current, s.ang0);
        hideIncoming(false);
      }
    } else {
      s.t += dt;
      const tt = Math.min(s.t, s.T);
      const ang = s.ang0 + s.omega0 * tt - (s.omega0 * tt * tt) / (2 * s.T);
      const u = Math.min(1, s.t / s.T);
      shift(inRef.current, 1 - easeOut(u));
      spinTo(spinInRef.current, ang);
      if (u >= 1) {
        inRef.current?.position.set(0, 0, 0);
        spinTo(spinInRef.current, 0);
        s.phase = null;
        slidingRef.current = false;
        onSlidingChange(false);
      }
    }
    invalidate();
  });

  return (
    <>
      <group ref={inRef} visible={!hidden}>
        <group ref={spinInRef} position={bboxCenter(part)}>
          <group position={bboxCenter(part, -1)}>
            <PartMesh part={part} showHidden={showHidden} colorMode={colorMode} metal={metal} />
          </group>
        </group>
      </group>
      {outgoing && (
        <group ref={outRef} key={outgoing.id}>
          <group ref={spinOutRef} position={bboxCenter(outgoing.part)}>
            <group position={bboxCenter(outgoing.part, -1)}>
              <PartMesh part={outgoing.part} showHidden={showHidden} colorMode={colorMode} metal={metal} />
            </group>
          </group>
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
/**
 * Αποστάσεις παυλών (2 ανά ακμή) από τη θέση στον χώρο: προβολή πάνω στη διεύθυνση της ακμής, με ίδια
 * φορά για παράλληλες ακμές. Έτσι ακμές που συμπίπτουν στην οθόνη έχουν τις παύλες στο ίδιο σημείο.
 */
function alignedDashDistances(pos: ArrayLike<number>): Float32Array {
  const out = new Float32Array((pos.length / 6) * 2);
  for (let i = 0; i < pos.length / 6; i++) {
    const o = i * 6;
    let dx = pos[o + 3] - pos[o];
    let dy = pos[o + 4] - pos[o + 1];
    let dz = pos[o + 5] - pos[o + 2];
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len;
    dy /= len;
    dz /= len;
    const e = 1e-6;
    if (dx < -e || (Math.abs(dx) <= e && (dy < -e || (Math.abs(dy) <= e && dz < 0)))) {
      dx = -dx;
      dy = -dy;
      dz = -dz;
    }
    out[i * 2] = pos[o] * dx + pos[o + 1] * dy + pos[o + 2] * dz;
    out[i * 2 + 1] = pos[o + 3] * dx + pos[o + 4] * dy + pos[o + 5] * dz;
  }
  return out;
}

/**
 * Χρώμα των κρυμμένων γραμμών: το ίδιο με των διαστάσεων (--dim) για το τρέχον φόντο: γκρι στο φωτεινό, μπλε στο
 * σκούρο μπλε, άσπρο στο γκρι και στο μαύρο.
 */
const dimColor = () => getComputedStyle(document.documentElement).getPropertyValue('--dim').trim() || '#ffffff';

/** Πάνω από τόσα τρίγωνα δεν υπολογίζουμε περιγράμματα καμπύλων σε κάθε κίνηση (κόστος). */
const MAX_SILHOUETTE_TRIANGLES = 200_000;

/**
 * Κρυφά περιγράμματα καμπύλων επιφανειών (π.χ. τα τοιχώματα της οπής λίπανσης, η οπή του άξονα):
 * δεν είναι ακμές του σχήματος, εξαρτώνται από τη ματιά, άρα υπολογίζονται ξανά όταν γυρίζει η κάμερα.
 * Εμφανίζονται ομαλά μόλις χτιστούν οι υπόλοιπες κρυφές γραμμές.
 */
function HiddenSilhouettes({ triangles, show }: { triangles: Float32Array; show: boolean }) {
  const camera = useThree((s) => s.camera) as OrthographicCamera;
  const controls = useThree((s) => s.controls) as unknown as CameraControlsImpl | null;
  const invalidate = useThree((s) => s.invalidate);
  const topo = useMemo(() => (triangles.length / 9 <= MAX_SILHOUETTE_TRIANGLES ? edgeTopology(triangles) : null), [triangles]);
  const line = useMemo(() => {
    const g = new LineSegmentsGeometry();
    g.setPositions([0, 0, 0, 0, 0, 0]);
    const m = new LineMaterial({ color: 0xffffff, linewidth: 1.6, dashed: true, transparent: true, opacity: 0, depthWrite: false });
    m.depthFunc = GreaterDepth;
    const l = new LineSegments2(g, m);
    l.renderOrder = 1;
    l.visible = false;
    return l;
  }, []);
  useEffect(
    () => () => {
      line.geometry.dispose();
      line.material.dispose();
    },
    [line],
  );
  const state = useRef({ dir: new Vector3(), target: new Vector3(), topo: null as unknown, wait: 0 });
  const themeSeen = useRef('');
  useEffect(() => invalidate(), [show, invalidate]);
  useFrame((_, delta) => {
    const st = state.current;
    const m = line.material;
    const theme = document.documentElement.dataset.theme ?? '';
    if (themeSeen.current !== theme) {
      themeSeen.current = theme;
      m.color.set(dimColor());
      invalidate();
    }
    const px = 1 / camera.zoom;
    m.dashSize = 4 * px;
    m.gapSize = 4 * px;
    if (!topo || !controls) {
      line.visible = false;
      return;
    }
    // ματιά από το μοντέλο προς την κάμερα
    controls.getTarget(st.target, false);
    const dir = camera.position.clone().sub(st.target).normalize();
    if (st.topo !== topo || dir.angleTo(st.dir) > 0.004) {
      st.dir.copy(dir);
      st.topo = topo;
      const segs = silhouettes(topo, [dir.x, dir.y, dir.z]);
      const pts = segs.length ? segs : new Float32Array(6);
      const g = new LineSegmentsGeometry();
      g.setPositions(pts);
      line.geometry.dispose();
      line.geometry = g;
      line.computeLineDistances(); // δημιουργεί τις αποστάσεις παυλών· μετά τις ευθυγραμμίζουμε
      const d = (g.getAttribute('instanceDistanceStart') as unknown as { data: { array: Float32Array; needsUpdate: boolean } }).data;
      d.array.set(alignedDashDistances(pts));
      d.needsUpdate = true;
    }
    // ομαλή εμφάνιση μετά το χτίσιμο των ακμών, γρήγορο σβήσιμο στο κλείσιμο
    const dt = Math.min(delta, 1 / 30);
    let target = 0;
    if (show) {
      st.wait += dt;
      if (st.wait > BUILD_TIME * 0.8 || reducedMotion()) target = 1;
    } else st.wait = 0;
    const next = reducedMotion() ? target : target > m.opacity ? Math.min(target, m.opacity + dt / 0.35) : Math.max(target, m.opacity - dt / 0.2);
    if (next !== m.opacity || (show && st.wait <= BUILD_TIME * 0.8)) invalidate();
    m.opacity = next;
    line.visible = m.opacity > 0;
  });
  return <primitive object={line} />;
}

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
    // Λευκό με πλήρη αδιαφάνεια: οι κρυμμένες ακμές φαίνονται πάνω στο γκρι μοντέλο.
    const m = new LineMaterial({
      color: 0xffffff,
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
    const fullDist = alignedDashDistances(fullPos);
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
  const themeSeen = useRef('');
  useFrame((_, delta) => {
    const px = 1 / camera.zoom;
    const theme = document.documentElement.dataset.theme ?? '';
    if (themeSeen.current !== theme) {
      themeSeen.current = theme;
      line.material.color.set(dimColor());
      invalidate();
    }
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

/** Απαλό «στούντιο» για τις αντανακλάσεις του μετάλλου (δημιουργείται τοπικά, χωρίς αρχεία από το διαδίκτυο). */
function StudioEnvironment() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const pmrem = new PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const target = pmrem.fromScene(room, 0.04);
    scene.environment = target.texture;
    scene.environmentIntensity = 0.35;
    invalidate();
    return () => {
      scene.environment = null;
      target.dispose();
      room.dispose();
      pmrem.dispose();
      invalidate();
    };
  }, [gl, scene, invalidate]);
  return null;
}

function FloatingMesh({ piece, showHidden, colorMode, metal }: { piece: FloatingPiece; showHidden: boolean; colorMode: boolean; metal: boolean }) {
  const group = useRef<Group>(null);
  const invalidate = useThree((s) => s.invalidate);
  // όσο υπάρχει το κομμάτι, ζητάμε συνεχώς νέο καρέ (η σκηνή είναι «κατ’ απαίτηση»)
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const { pos, rot } = piece.poseRef.current;
    g.position.set(pos[0], pos[1], pos[2]);
    g.rotation.set(rot[0], rot[1], rot[2], 'ZYX');
    invalidate();
  });
  const [px, py, pz] = piece.pivot;
  return (
    <group ref={group}>
      <group position={[-px, -py, -pz]}>
        <PartMesh part={piece.part} showHidden={showHidden} colorMode={colorMode} metal={metal} />
      </group>
    </group>
  );
}

interface ControllerProps {
  part: Part;
  scale: Scale;
  dimsMode: DimsMode;
  /** διακεκομμένες γραμμές ενεργές: δεν χρειάζονται οι γραμμές στις κρυμμένες κορυφές των διαστάσεων */
  showHidden: boolean;
  tightFit: boolean;
  dimStyle?: DimStyle;
  clipBox?: BBox;
  apiRef: RefObject<SceneApi | null>;
  slidingRef: RefObject<boolean>;
  overlayRef: RefObject<SVGGElement | null>;
  focusRef: RefObject<string | null>;
  onViewChange: (view: ViewId | null) => void;
  onFrameRef: RefObject<ViewerProps['onFrame']>;
}

function SceneController({ part, scale, dimsMode, showHidden, tightFit, dimStyle, clipBox, apiRef, slidingRef, overlayRef, focusRef, onViewChange, onFrameRef }: ControllerProps) {
  const camera = useThree((s) => s.camera) as OrthographicCamera;
  const gl = useThree((s) => s.gl);
  // Ο έλεγχος κάμερας (makeDefault) μπαίνει στο store μετά την πρώτη απόδοση.
  const controls = useThree((s) => s.controls) as unknown as CameraControlsImpl | null;
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const lightRef = useRef<DirectionalLight>(null);
  const metrics = useMemo(() => partMetrics(part, clipBox), [part, clipBox]);
  const corners = useMemo(() => bboxCorners(part.bbox), [part]);

  const state = useRef({
    reported: undefined as ViewId | null | undefined,
    pending: null as ViewId | null,
    lastSvg: '',
    initialised: false,
    labelMemory: new Map<string, number>(),
    labelGlide: new Map<string, [number, number]>(),
    /** κομμάτι και λειτουργία διαστάσεων της τελευταίας εικόνας· αλλαγή τους παίζει την είσοδο των διαστάσεων */
    lastPart: null as Part | null,
    lastDims: null as DimsMode | null,
    ghostTimer: 0,
    fadeIn: null as { at: number; ids: Set<string> } | null,
  });

  // Ξεκαθαρίζει τα χρονόμετρα των κινούμενων διαστάσεων αν φύγει η σκηνή.
  useEffect(() => {
    const st = state.current;
    return () => {
      window.clearTimeout(st.ghostTimer);
    };
  }, []);

  // Τοποθέτηση κάμερας: ίδια κατεύθυνση, κέντρο στο μοντέλο, zoom ώστε να χωρά.
  const place = (dir: Vector3, animate: boolean) => {
    const c = controls;
    if (!c) return;
    const { center, distance } = metrics;
    c.smoothTime = 0.3; // ομαλή κίνηση όψης (η ροδέλα το μικραίνει προσωρινά)
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
    const margin = tightFit ? 24 : fitMargin(size.width, size.height, dimsMode);
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
    // Zoom (ροδέλα/τσίμπημα): λίγο πιο δυνατό από την προεπιλογή (~×1,9 ανά «κλικ» ροδέλας αντί ×1,67)
    // και κυρίως πιο άμεσο: με τη ροδέλα η εξομάλυνση γίνεται 0,12 s αντί 0,3 s, ώστε να μη «σέρνεται».
    // Οι κινήσεις αλλαγής όψης κρατούν το 0,3 s (βλ. place).
    c.dollySpeed = 1.25;
    const onWheel = () => {
      c.smoothTime = 0.12;
    };
    gl.domElement.addEventListener('wheel', onWheel, { passive: true });
    c.minZoom = 1e-4;
    c.maxZoom = 1e5;
    // Με απόδοση «κατ' απαίτηση» το πρώτο καρέ μετά από αδράνεια έχει τεράστιο delta (όσο ήταν ακίνητη
    // η σκηνή): η κίνηση της κάμερας θα τελείωνε ακαριαία («πήδημα»). Περιορίζουμε το βήμα χρόνου.
    const update = c.update.bind(c) as (delta: number) => boolean;
    c.update = (delta: number) => update(Math.min(delta, 1 / 30));
    // «Μαγνήτης» όψεων: όταν ο χρήστης αφήνει την περιστροφή κοντά σε μια όψη (μέσα σε SNAP_ANGLE),
    // η κάμερα ισιώνει μόνη της και μπαίνει ακριβώς σε αυτήν.
    const startDir = new Vector3();
    const onUserStart = () => {
      state.current.pending = null;
      startDir.copy(currentDir());
    };
    const onUserEnd = () => {
      const dir = currentDir();
      if (dir.angleTo(startDir) < 0.01) return; // zoom ή μετακίνηση, όχι περιστροφή
      let best: ViewId | null = null;
      let bestAngle = SNAP_ANGLE;
      for (const v of VIEWS) {
        const a = dir.angleTo(viewBasis(v.dir).dir);
        if (a < bestAngle) {
          best = v.id;
          bestAngle = a;
        }
      }
      if (best) apiRef.current?.goTo(best);
    };
    c.addEventListener('controlstart', onUserStart);
    c.addEventListener('controlend', onUserEnd);
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__opseisDebug = { camera, controls: c };
    return () => {
      c.removeEventListener('controlstart', onUserStart);
      c.removeEventListener('controlend', onUserEnd);
      gl.domElement.removeEventListener('wheel', onWheel);
    };
  }, [controls, camera, gl]);

  useEffect(() => {
    state.current.lastSvg = '\u0000'; // αναγκαστικός επανυπολογισμός διαστάσεων
    invalidate();
  }, [scale, dimsMode, showHidden, tightFit, dimStyle, part, invalidate]);

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
      style: dimStyle,
      dims: part.dims,
      project,
      viewDir: [tmp.dir.x, tmp.dir.y, tmp.dir.z],
      corners,
      scale,
      mode: dimsMode,
      memory: s.labelMemory,
      glide: s.labelGlide,
      edges: part.edges,
      triangles: part.triangles,
      hiddenLinesShown: showHidden,
      cornerGhosts: shown === null, // μόνο στην ελεύθερη περιστροφή
    });
    if (svg !== s.lastSvg && overlayRef.current) {
      const g = overlayRef.current;
      // Αλλαγή λειτουργίας (ή πρώτη εμφάνιση): οι νέες διαστάσεις ξεθωριάζουν μέσα και όσες φεύγουν ξεθωριάζουν έξω.
      // Αλλαγή σχήματος: χωρίς κίνηση εδώ (τις κρύβει η μετάβαση του σχήματος). Περιστροφή: χωρίς κίνηση.
      const now = performance.now();
      const animate = (s.lastDims !== dimsMode || s.lastPart === null) && !reducedMotion();
      s.lastPart = part;
      s.lastDims = dimsMode;
      // οι διαστάσεις που υπήρχαν (χωρίς τα «φαντάσματα» που ξεθωριάζουν ήδη)
      const before = new Map<string, Element>();
      if (animate) g.querySelectorAll(':scope > g.dim:not(.dim-out)').forEach((el) => before.set(el.getAttribute('data-dim') ?? '', el.cloneNode(true) as Element));
      // νέο περιεχόμενο· τα φαντάσματα μένουν ως έχουν (αλλιώς θα ξανάρχιζε η κίνησή τους ή θα χάνονταν νωρίς)
      Array.from(g.children).forEach((el) => {
        if (!el.classList.contains('dim-out')) el.remove();
      });
      g.insertAdjacentHTML('afterbegin', svg);
      markFocus(g, focusRef.current);
      const fresh = Array.from(g.querySelectorAll(':scope > g.dim'));
      if (animate) {
        const ids = new Set<string>();
        const present = new Set(fresh.map((el) => el.getAttribute('data-dim') ?? ''));
        for (const id of present) if (!before.has(id)) ids.add(id);
        s.fadeIn = { at: now, ids };
        let ghosts = false;
        before.forEach((el, id) => {
          if (present.has(id)) return;
          el.classList.add('dim-out');
          g.appendChild(el);
          ghosts = true;
        });
        if (ghosts) {
          window.clearTimeout(s.ghostTimer);
          s.ghostTimer = window.setTimeout(() => g.querySelectorAll(':scope > g.dim-out').forEach((el) => el.remove()), DIMS_OUT_MS + 40);
        }
      }
      // η είσοδος συνεχίζεται από εκεί που ήταν, αν το περιεχόμενο ξαναχτιστεί όσο διαρκεί (π.χ. μια γρήγορη στροφή)
      if (s.fadeIn && now - s.fadeIn.at < DIMS_IN_MS) {
        for (const el of fresh) {
          if (!s.fadeIn.ids.has(el.getAttribute('data-dim') ?? '')) continue;
          el.classList.add('dim-in');
          (el as SVGElement).style.animationDelay = `-${Math.round(now - s.fadeIn.at)}ms`;
        }
      }
      s.lastSvg = svg;
    }
    onFrameRef.current?.(project, size);
  });

  return (
    <>
      <hemisphereLight args={['#ffffff', '#8a97a6', 1.4]} />
      <directionalLight ref={lightRef} intensity={1.6} />
    </>
  );
}

export function Viewer({ part, scale, dimsMode, dimStyle, clipBox, showHidden, colorMode, focusDim, theme, shape, onViewChange, onFrame, overlay, floating, metal = false, noSlide = false, tightFit = false, hidePart = false, ghost, scene, ref }: ViewerProps) {
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;
  const apiRef = useRef<SceneApi | null>(null);
  const slidingRef = useRef(false);
  // Όσο γλιστράνε τα σχήματα, οι διαστάσεις κρύβονται (θα έδειχναν στη λάθος θέση).
  const [sliding, setSliding] = useState(false);
  const overlayRef = useRef<SVGGElement | null>(null);
  const focusRef = useRef<string | null>(null);
  focusRef.current = focusDim ?? null;
  useEffect(() => markFocus(overlayRef.current, focusDim ?? null), [focusDim]);

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
        <color attach="background" args={[themeInfo(theme).viewerBg]} />
        <CameraControls makeDefault />
        {metal && <StudioEnvironment />}
        <SlidingParts
          part={part}
          shape={shape}
          showHidden={showHidden}
          colorMode={colorMode}
          metal={metal}
          noSlide={noSlide}
          hidden={hidePart}
          slidingRef={slidingRef}
          apiRef={apiRef}
          onSlidingChange={setSliding}
        />
        {ghost && <PartMesh part={ghost.part} showHidden={false} colorMode={colorMode} metal={metal} opacityRef={ghost.opacityRef} />}
        {scene}
        {floating && <FloatingMesh piece={floating} showHidden={showHidden} colorMode={colorMode} metal={metal} />}
        <SceneController
          part={part}
          scale={scale}
          dimsMode={dimsMode}
          tightFit={tightFit}
          showHidden={showHidden}
          dimStyle={dimStyle}
          clipBox={clipBox}
          apiRef={apiRef}
          slidingRef={slidingRef}
          overlayRef={overlayRef}
          focusRef={focusRef}
          onViewChange={onViewChange}
          onFrameRef={onFrameRef}
        />
      </Canvas>
      <svg className={`dims-overlay${sliding || hidePart ? ' sliding' : ''}`} aria-hidden="true">
        <g ref={overlayRef} />
      </svg>
      {overlay && (
        <div className={`viewer-anchors${sliding ? ' sliding' : ''}`}>
          {overlay}
        </div>
      )}
    </div>
  );
}
