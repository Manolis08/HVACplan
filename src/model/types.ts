// Σύστημα συντεταγμένων μοντέλου (όπως στο τεχνικό σχέδιο):
// X = μήκος (δεξιά), Y = βάθος (προς τα πίσω), Z = ύψος (πάνω). Μονάδες: mm.
export type Vec3 = [number, number, number];

export interface BBox {
  min: Vec3;
  max: Vec3;
}

/** Διάσταση για τις ετικέτες του 3D. Η τιμή είναι ΠΑΝΤΑ το πραγματικό μέτρο σε mm. */
export type DimSpec =
  | {
      kind: 'linear';
      id: string;
      value: number;
      a: Vec3;
      b: Vec3;
      /** Υποψήφιες κατευθύνσεις μετατόπισης (μοναδιαίες, προς τα έξω), κατά σειρά προτίμησης. */
      offsets: Vec3[];
      /** Συνολική διάσταση (μήκος/βάθος/ύψος) ή διάσταση χαρακτηριστικού. */
      overall: boolean;
    }
  | {
      kind: 'diameter';
      id: string;
      value: number;
      center: Vec3;
      /** Άξονας της οπής (μοναδιαίο, παράλληλο σε άξονα X/Y/Z). */
      axis: Vec3;
      overall: false;
    }
  | {
      kind: 'radius';
      id: string;
      /** Ακτίνα σε mm. */
      value: number;
      center: Vec3;
      axis: Vec3;
      /** Κατεύθυνση της γραμμής από το κέντρο προς το τόξο (μοναδιαία, κάθετη στον άξονα). */
      dir: Vec3;
      overall: false;
    };

/** Κυκλική οπή με ακριβή μέτρα (για άξονες και Ø στο φύλλο όψεων). */
export interface CircleFeature {
  center: Vec3;
  axis: Vec3;
  radius: number;
  /** Μήκος της οπής κατά τον άξονα, από το center προς +axis. */
  length: number;
}

export interface PartGeometry {
  /** Τρίγωνα χωρίς δείκτες: x,y,z ανά κορυφή, 3 κορυφές ανά τρίγωνο. */
  triangles: Float32Array;
  /** Ακμές ως ζεύγη σημείων: x1,y1,z1,x2,y2,z2 ανά ακμή. */
  edges: Float32Array;
  bbox: BBox;
}

export interface InfoItem {
  label: string;
  value: number;
  unit: 'mm' | '°';
}

export interface Part extends PartGeometry {
  dims: DimSpec[];
  circles: CircleFeature[];
  info: InfoItem[];
  /** Σχεδίαση του κουτιού που περικλείει το κομμάτι (για ανεβασμένα αρχεία). */
  showBox?: boolean;
}

export interface ParamDef {
  key: string;
  label: string;
  /** Άξονας ή σύντομη ένδειξη δίπλα στην ετικέτα, π.χ. "X". */
  axis?: string;
  defaultValue: number;
  /** Δέχεται και αρνητικές τιμές ή μηδέν (π.χ. θέση από το κέντρο). */
  signed?: boolean;
}

export interface ToggleDef {
  key: string;
  label: string;
  defaultValue: boolean;
}

export type Values = Record<string, number>;
export type Toggles = Record<string, boolean>;

export interface Issue {
  /** Πεδία που αφορά το μήνυμα (για επισήμανση στη φόρμα). */
  fields: string[];
  message: string;
}

export interface TemplateDef {
  id: string;
  name: string;
  description: string;
  params: ParamDef[];
  toggles?: ToggleDef[];
  /** Πεδία που κλειδώνουν όταν είναι ενεργός ο αντίστοιχος διακόπτης: { πεδίο: διακόπτης }. */
  lockedBy?: Record<string, string>;
  /** Τιμές των κλειδωμένων πεδίων (π.χ. οπή στο κέντρο), από τις υπόλοιπες τιμές. */
  computed?: (v: Values, t: Toggles) => Partial<Values>;
  validate: (v: Values, t: Toggles) => Issue[];
  build: (v: Values, t: Toggles) => Part;
}
