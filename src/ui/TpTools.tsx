import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { BufferGeometry, DoubleSide, Float32BufferAttribute, Group, Matrix4, MeshStandardMaterial, Vector3, type Mesh } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { toolPoses, type Op, type PieceId, type ToolKind } from '../model/tpProcess';
import type { Vec3 } from '../model/types';

// Τα εργαλεία της κατεργασίας του Τ+Π (τρυπάνι, σιδεροπρίονο, λίμα) ως ημιδιαφανή «φαντάσματα» μέσα στη
// σκηνή. Οι θέσεις τους βγαίνουν από το model/tpProcess· εδώ φορτώνονται τα μοντέλα και μπαίνουν οι
// κινήσεις που εξαρτώνται από τον χρόνο: γυρίζει το τσοκ, το πριόνι και η λίμα πάνε μπρος-πίσω.
//
// Μοντέλα (public/tools, μόνο η γεωμετρία, χωρίς υφές):
//   drill.glb   «Drill "Soviet"», Sergey Khanin, CC-BY-4.0 (sketchfab.com/3d-models/drill-soviet-659d98a6051b4438a66a30b96931234e)
//   hacksaw.glb «PB100 Hacksaw SM», Makovetkyi Volodymyr, CC-BY-4.0 (sketchfab.com/3d-models/pb100-hacksaw-sm-449724f69c8f48fcbb372e712853e50b)
//   file.glb    μεταλλική λίμα (εξαγωγή από three.js)

/** Τι χρειάζονται τα εργαλεία σε κάθε καρέ (ενημερώνεται από το TpView χωρίς νέα απόδοση). */
export interface ToolsSource {
  schedule: Op[];
  /** πρόοδος της κατεργασίας 0…1 (συνεχής, όχι στρογγυλεμένη) */
  tau: number;
  /** πού βρίσκεται κάθε κομμάτι (X, Y)· λείπει = δεν φαίνεται */
  offsets: Partial<Record<PieceId, [number, number]>>;
  /** η μπάρα κινείται: τα εργαλεία δουλεύουν (αλλιώς σταματούν εκεί που είναι) */
  running: boolean;
}

/**
 * Από τις συντεταγμένες κάθε μοντέλου στο «κανονικό» σύστημα του εργαλείου (βλ. ToolPose): κλίμακα, σημείο
 * εργασίας (στις μονάδες του μοντέλου) και πού πάνε οι άξονες X, Y, Z του μοντέλου. Μετρημένα από τα αρχεία.
 */
const CAL: Record<ToolKind, { url: string; scale: number; key: Vec3; axes: [Vec3, Vec3, Vec3]; spinAbove?: number }> = {
  // μέτρα· τρυπάνι Ø4,8 κατά +Z στο y = 0,0762, μύτη στο z = 0,2332, λαβή προς −Y. Κλίμακα ώστε το τρυπάνι = Ø1,9 (η τρύπα).
  // Το τσοκ και το τρυπάνι (z > 0,099) γυρίζουν, το σώμα όχι.
  drill: { url: 'tools/drill.glb', scale: 400, key: [0, 0.0762, 0.2332], axes: [[0, -1, 0], [-1, 0, 0], [0, 0, -1]], spinAbove: 0.099 },
  // λάμα περίπου κατά +Z (προς τη λαβή), δόντια προς −Y, στη μέση της λάμας z ≈ 25. 28 % του πραγματικού.
  // Η λάμα του μοντέλου γέρνει ~4,8° από τον άξονα Z: οι άξονες εδώ είναι μετρημένοι πάνω στη λάμα (ακμή δοντιών, πλάτος,
  // μήκος), ώστε στην κατεργασία να στέκεται ακριβώς όρθια και το σημείο εργασίας να είναι πάνω στον άξονά της.
  saw: { url: 'tools/hacksaw.glb', scale: 2.8, key: [3.923, -4.254, 25], axes: [[0.0032, 0.9983, -0.0585], [-0.9985, 0, -0.0554], [-0.0553, 0.0586, 0.9968]] },
  // μέτρα· λίμα κατά X (μύτη στο −X), επίπεδη επιφάνεια στο y = 0,0041 με το σώμα προς +Y. Περίπου το 25 % του πραγματικού.
  file: { url: 'tools/file.glb', scale: 250, key: [-0.095, 0.0041, 0], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] },
};

/** Συχνότητα (Hz) της κίνησης μπρος-πίσω και στροφές του τσοκ ανά δευτερόλεπτο. */
const STROKE_HZ: Record<ToolKind, number> = { drill: 0, saw: 1.6, file: 1.2 };
const SPIN_HZ = 6;

interface ToolModel {
  body: BufferGeometry;
  spin?: BufferGeometry;
}

const cache = new Map<ToolKind, Promise<ToolModel>>();

/** Φόρτωση ενός μοντέλου και «ψήσιμο» της γεωμετρίας του στο κανονικό σύστημα του εργαλείου. */
function loadTool(kind: ToolKind): Promise<ToolModel> {
  const hit = cache.get(kind);
  if (hit) return hit;
  const cal = CAL[kind];
  const promise = new GLTFLoader().loadAsync(import.meta.env.BASE_URL + cal.url).then((gltf) => {
    gltf.scene.updateMatrixWorld(true);
    const axes = new Matrix4().makeBasis(...(cal.axes.map((a) => new Vector3(...a)) as [Vector3, Vector3, Vector3]));
    const body: number[] = [];
    const spin: number[] = [];
    const v = new Vector3();
    const key = new Vector3(...cal.key);
    gltf.scene.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
      g.applyMatrix4(mesh.matrixWorld);
      const pos = g.getAttribute('position');
      for (let t = 0; t < pos.count; t += 3) {
        const spins = cal.spinAbove !== undefined && [0, 1, 2].every((k) => pos.getZ(t + k) > cal.spinAbove!);
        const out = spins ? spin : body;
        for (let k = 0; k < 3; k++) {
          v.fromBufferAttribute(pos, t + k).sub(key).multiplyScalar(cal.scale).applyMatrix4(axes);
          out.push(v.x, v.y, v.z);
        }
      }
      g.dispose();
    });
    const geometry = (arr: number[]) => {
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute(arr, 3));
      g.computeVertexNormals();
      return g;
    };
    return { body: geometry(body), spin: spin.length ? geometry(spin) : undefined };
  });
  cache.set(kind, promise);
  return promise;
}

const KINDS: ToolKind[] = ['drill', 'saw', 'file'];

export function TpTools({ sourceRef }: { sourceRef: RefObject<ToolsSource | null> }) {
  const [models, setModels] = useState<Partial<Record<ToolKind, ToolModel>>>({});
  useEffect(() => {
    let alive = true;
    for (const kind of KINDS)
      loadTool(kind)
        .then((m) => alive && setModels((s) => ({ ...s, [kind]: m })))
        .catch(() => {
          // χωρίς το μοντέλο απλώς δεν φαίνεται το εργαλείο· η κατεργασία προχωρά κανονικά
        });
    return () => {
      alive = false;
    };
  }, []);

  // ένα υλικό ανά εργαλείο (η διαφάνεια αλλάζει χωριστά): ανοιχτό μπλε «φάντασμα»
  const materials = useMemo(
    () =>
      Object.fromEntries(
        KINDS.map((k) => [
          k,
          new MeshStandardMaterial({ color: '#bcd6ff', transparent: true, opacity: 0, depthWrite: false, roughness: 0.35, metalness: 0.15, side: DoubleSide }),
        ]),
      ) as Record<ToolKind, MeshStandardMaterial>,
    [],
  );
  useEffect(() => () => Object.values(materials).forEach((m) => m.dispose()), [materials]);

  const groups = useRef<Partial<Record<ToolKind, Group | null>>>({});
  const chuck = useRef<Group | null>(null);
  const anim = useRef({ activity: 0, stroke: 0, spin: 0 });
  const invalidate = useThree((s) => s.invalidate);
  const tmp = useMemo(() => ({ axis: new Vector3() }), []);

  useFrame((_, delta) => {
    const src = sourceRef.current;
    if (!src) return;
    const dt = Math.min(delta, 1 / 30);
    const a = anim.current;
    // όσο κινείται η μπάρα τα εργαλεία δουλεύουν· όταν σταματήσει, ηρεμούν ομαλά
    a.activity += ((src.running ? 1 : 0) - a.activity) * Math.min(1, dt * 6);
    a.stroke += dt * a.activity;
    const poses = toolPoses(src.schedule, src.tau, src.offsets);
    for (const kind of KINDS) {
      const g = groups.current[kind];
      if (!g) continue;
      const pose = poses.find((p) => p.kind === kind);
      g.visible = !!pose;
      if (!pose) continue;
      materials[kind].opacity = pose.opacity;
      const s = pose.strokeAmp * a.activity * Math.sin(2 * Math.PI * STROKE_HZ[kind] * a.stroke);
      tmp.axis.set(...pose.strokeAxis);
      g.position.set(...pose.pos).addScaledVector(tmp.axis, s);
      g.quaternion.set(...pose.quat);
      if (kind === 'drill' && chuck.current) {
        if (pose.spin) a.spin += dt * a.activity * 2 * Math.PI * SPIN_HZ;
        chuck.current.rotation.z = a.spin;
      }
    }
    if (poses.length && a.activity > 0.01) invalidate();
  });

  return (
    <>
      {KINDS.map((kind) => {
        const m = models[kind];
        return (
          <group key={kind} ref={(g) => void (groups.current[kind] = g)} visible={false} renderOrder={5}>
            {m && <mesh geometry={m.body} material={materials[kind]} renderOrder={5} />}
            {m?.spin && (
              <group ref={chuck}>
                <mesh geometry={m.spin} material={materials[kind]} renderOrder={5} />
              </group>
            )}
          </group>
        );
      })}
    </>
  );
}
