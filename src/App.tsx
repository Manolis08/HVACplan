import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { configureDraco } from './io/draco';
import { ModelError, technical } from './io/errors';
import { fromBrowserFile, loadModel } from './io/loadModel';
import { buildFilePart, IDENTITY, prepareModel } from './io/meshTools';
import { DEFAULT_SCALE, loadState, saveState, type ShapeScale } from './lib/persist';
import { sameScale, scaleHint, scaleLabel, type Scale } from './lib/scale';
import { applyTheme, initialTheme, type Theme } from './lib/theme';
import { defaultInputs, defaultToggles, evaluate } from './model/evaluate';
import { TEMPLATES, templateById } from './model/templates';
import type { Part, Toggles } from './model/types';
import { FilePanel, FilePicker, type FileOptions, type LoadedFile } from './ui/FilePanel';
import { ParamForm } from './ui/ParamForm';
import { PwaBanner } from './ui/PwaBanner';
import type { ProjectionAngle } from './ui/ProjectionSymbol';
import { ScaleSelector } from './ui/ScaleSelector';
import { TemplatePicker } from './ui/TemplatePicker';
import { SheetView } from './ui/SheetView';
import { ViewToolbar } from './ui/ViewToolbar';
import type { DimsMode } from './viewer/dimLayout';
import { FACE_COLORS, Viewer, type ViewerApi } from './viewer/Viewer';
import { viewLabel, type ViewId } from './viewer/views';

const saved = loadState();

const initialInputs = () =>
  Object.fromEntries(TEMPLATES.map((t) => [t.id, { ...defaultInputs(t), ...saved.inputs?.[t.id] }]));
const initialToggles = () =>
  Object.fromEntries(TEMPLATES.map((t) => [t.id, { ...defaultToggles(t), ...saved.toggles?.[t.id] }]));

const NO_OPTIONS: FileOptions = { unit: null, up: null, rotation: IDENTITY, confirmed: false };

const DIMS_MODES: { id: DimsMode; label: string }[] = [
  { id: 'all', label: 'Όλες' },
  { id: 'essential', label: 'Απαραίτητες' },
  { id: 'none', label: 'Καμία' },
];

export default function App() {
  const [templateId, setTemplateId] = useState(saved.templateId ?? TEMPLATES[0].id);
  const [inputs, setInputs] = useState<Record<string, Record<string, string>>>(initialInputs);
  const [toggles, setToggles] = useState<Record<string, Toggles>>(initialToggles);
  // Κλίμακα ανά σχήμα, χωριστά για το 3D και για το φύλλο όψεων.
  // 3D: 1:1 μέχρι να την αλλάξει ο χρήστης. Φύλλο: προτεινόμενη μέχρι να την αλλάξει ο χρήστης.
  const [viewerScales, setViewerScales] = useState<Record<string, Scale>>(saved.viewerScales ?? {});
  const [sheetScales, setSheetScales] = useState<Record<string, ShapeScale>>(saved.sheetScales ?? {});
  // Γωνία προβολής: πάντα 1η (Ευρωπαϊκή, ISO E).
  const projection: ProjectionAngle = 'first';
  const [dimsMode, setDimsMode] = useState<DimsMode>(saved.dimsMode ?? 'all');
  // Σειρά και ονόματα των έτοιμων σχημάτων, όπως τα όρισε ο χρήστης (αποθηκεύονται στη συσκευή).
  const [templateOrder, setTemplateOrder] = useState<string[]>(saved.templateOrder ?? []);
  const [templateNames, setTemplateNames] = useState<Record<string, string>>(saved.templateNames ?? {});
  const orderedTemplates = useMemo(() => {
    const known = templateOrder.map((id) => TEMPLATES.find((t) => t.id === id)).filter((t) => t !== undefined);
    return [...known, ...TEMPLATES.filter((t) => !templateOrder.includes(t.id))];
  }, [templateOrder]);
  const nameOf = (t: { id: string; name: string }) => templateNames[t.id] ?? t.name;
  const [view, setView] = useState<ViewId | null>('iso');
  const viewerRef = useRef<ViewerApi>(null);
  const [pane, setPane] = useState<'3d' | 'sheet'>('3d');
  const [theme, setTheme] = useState<Theme>(initialTheme);
  useEffect(() => applyTheme(theme), [theme]);
  // Κρυφές γραμμές στο 3D: σβηστές σε κάθε άνοιγμα της εφαρμογής.
  const [showHidden, setShowHidden] = useState(false);
  const [colorMode, setColorMode] = useState(false);
  // Παράθυρο κλίμακας 3D (ανοίγει από το κουμπί «Κλίμακα» πάνω δεξιά στην προβολή).
  const [scaleOpen, setScaleOpen] = useState(false);
  const scaleChipRef = useRef<HTMLButtonElement>(null);
  const scalePopoverRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!scaleOpen) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!scalePopoverRef.current?.contains(t) && !scaleChipRef.current?.contains(t)) setScaleOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setScaleOpen(false);
        scaleChipRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [scaleOpen]);
  // Πλήρης οθόνη της προβολής (3D ή φύλλο όψεων). Όπου ο browser δεν την υποστηρίζει για
  // στοιχεία σελίδας (π.χ. iPhone), η προβολή απλώνεται σε όλο το παράθυρο με CSS.
  const viewerPaneRef = useRef<HTMLElement>(null);
  const [nativeFullscreen, setNativeFullscreen] = useState(false);
  const [cssFullscreen, setCssFullscreen] = useState(false);
  const fullscreen = nativeFullscreen || cssFullscreen;
  useEffect(() => {
    const onChange = () => {
      const on = !!document.fullscreenElement && document.fullscreenElement === viewerPaneRef.current;
      setNativeFullscreen(on);
      if (on) setCssFullscreen(false);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  useEffect(() => {
    if (!cssFullscreen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setCssFullscreen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [cssFullscreen]);
  const lockLandscape = () => {
    const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    o?.lock?.('landscape').catch(() => {});
  };
  const toggleFullscreen = () => {
    if (cssFullscreen) return setCssFullscreen(false);
    if (document.fullscreenElement) {
      screen.orientation?.unlock?.();
      return void document.exitFullscreen().catch(() => {});
    }
    const el = viewerPaneRef.current;
    if (!el?.requestFullscreen) return setCssFullscreen(true);
    // Αν ο browser αρνηθεί ή δεν απαντήσει (π.χ. περιμένει άδεια), απλώνουμε με CSS.
    let settled = false;
    el.requestFullscreen().then(
      () => {
        settled = true;
        // Φύλλο όψεων: ζητάμε οριζόντια οθόνη όπου επιτρέπεται (π.χ. Android). Στο iPhone δεν
        // επιτρέπεται· εκεί το ίδιο το χαρτί γυρίζει με CSS όταν η οθόνη είναι όρθια.
        if (pane === 'sheet') lockLandscape();
      },
      () => {
        settled = true;
        setCssFullscreen(true);
      },
    );
    setTimeout(() => {
      if (!settled && !document.fullscreenElement) setCssFullscreen(true);
    }, 800);
  };
  // Πεδία μέτρων του έτοιμου σχήματος: κρυμμένα μέχρι να τα ζητήσει ο χρήστης.
  const [paramsOpen, setParamsOpen] = useState(false);

  // Λειτουργία «Αρχείο 3D». Το αρχείο μένει μόνο στη μνήμη της σελίδας.
  const [mode, setMode] = useState<'template' | 'file'>('template');
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [fileOptions, setFileOptions] = useState<FileOptions>(NO_OPTIONS);
  const [loadingName, setLoadingName] = useState<string | null>(null);
  const [fileError, setFileError] = useState<{ message: string; detail?: string } | null>(null);
  const [dragging, setDragging] = useState(false);

  const openFiles = useCallback(async (files: File[]) => {
    setMode('file');
    setFileError(null);
    setLoadingName(files[0]?.name ?? '');
    // Μικρή παύση ώστε να φανεί η ένδειξη φόρτωσης πριν τη βαριά δουλειά.
    await new Promise((r) => setTimeout(r, 30));
    try {
      const raw = await loadModel(files.map(fromBrowserFile), { configureGltf: configureDraco });
      const prepared = prepareModel(raw.triangles);
      setFile({ raw, prepared });
      setFileOptions({ unit: raw.suggested.unit ?? null, up: raw.suggested.up ?? null, rotation: IDENTITY, confirmed: false });
    } catch (e) {
      setFileError(
        e instanceof ModelError
          ? { message: e.message, detail: e.detail }
          : { message: 'Απρόσμενο σφάλμα κατά το άνοιγμα του αρχείου.', detail: technical(e) },
      );
    } finally {
      setLoadingName(null);
    }
  }, []);

  // Σύρσιμο αρχείου οπουδήποτε στο παράθυρο (υπολογιστής).
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setDragging(true);
    };
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length) void openFiles(files);
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [openFiles]);

  // Μέχρι να επιβεβαιωθούν μονάδα και άξονας, η προβολή δείχνει προσωρινά mm / Z πάνω, χωρίς διαστάσεις.
  const filePart = useMemo(
    () =>
      file
        ? buildFilePart(file.prepared, {
            unit: fileOptions.unit ?? 'mm',
            up: fileOptions.up ?? 'Z',
            rotation: fileOptions.rotation,
          })
        : null,
    [file, fileOptions.unit, fileOptions.up, fileOptions.rotation],
  );

  const template = templateById(templateId);
  const evaluation = useMemo(
    () => evaluate(template, inputs[template.id], toggles[template.id]),
    [template, inputs, toggles],
  );

  // Όσο τα μέτρα έχουν σφάλμα, δείχνουμε το τελευταίο έγκυρο σχήμα του ίδιου προτύπου.
  const lastValid = useRef<Record<string, Part>>({});
  if (evaluation.part) lastValid.current[template.id] = evaluation.part;
  const shownPart =
    evaluation.part ??
    lastValid.current[template.id] ??
    evaluate(template, defaultInputs(template), defaultToggles(template)).part!;
  const stale = !evaluation.part;

  const fileMode = mode === 'file';
  const shapeKey = fileMode ? `file:${file?.raw.name ?? ''}` : template.id;
  const viewerScale = viewerScales[shapeKey] ?? DEFAULT_SCALE;
  const sheetScale = sheetScales[shapeKey]?.scale ?? DEFAULT_SCALE;
  // Ο επιλογέας κλίμακας αλλάζει μόνο την προβολή που είναι ανοιχτή.
  const setScale = (s: Scale) =>
    pane === 'sheet'
      ? setSheetScales((prev) => ({ ...prev, [shapeKey]: { scale: s, manual: true } }))
      : setViewerScales((prev) => ({ ...prev, [shapeKey]: s }));
  // Το φύλλο όψεων στέλνει την προτεινόμενη κλίμακα όταν ανοίγει (και όταν αλλάζει το σχήμα του).
  // Ισχύει μόνο αν ο χρήστης δεν έχει διαλέξει ήδη κλίμακα για αυτό το σχήμα.
  const applySuggestedScale = useCallback(
    (s: Scale) =>
      setSheetScales((prev) => {
        const cur = prev[shapeKey];
        if (cur && (cur.manual || sameScale(cur.scale, s))) return prev;
        return { ...prev, [shapeKey]: { scale: s, manual: false } };
      }),
    [shapeKey],
  );
  const viewerPart = fileMode && filePart ? filePart : shownPart;
  const effectiveDims: DimsMode = fileMode && (!file || !fileOptions.confirmed) ? 'none' : dimsMode;
  const openMesh = fileMode && !!file && (file.prepared.stats.boundaryEdges > 0 || file.prepared.stats.nonManifoldEdges > 0);
  const edgeCount = viewerPart.edges.length / 6;
  const sheetBlocked = fileMode
    ? !file
      ? 'Άνοιξε πρώτα ένα αρχείο 3D.'
      : !fileOptions.confirmed
        ? 'Επιβεβαίωσε πρώτα μονάδα και πάνω άξονα του αρχείου.'
        : undefined
    : undefined;

  useEffect(() => {
    saveState({ templateId, inputs, toggles, viewerScales, sheetScales, projection, dimsMode, templateOrder, templateNames });
  }, [templateId, inputs, toggles, viewerScales, sheetScales, dimsMode, templateOrder, templateNames]);

  // Βοήθεια για αυτόματους ελέγχους στον browser (μόνο σε ανάπτυξη).
  useEffect(() => {
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__opseis = { part: viewerPart, scale: viewerScale, view, fileOptions };
    }
  }, [viewerPart, viewerScale, view, fileOptions]);

  return (
    <div className="app">
      <header className="app-header">
        <h1>HVACplan</h1>
        <div className="header-right">
          <span className="header-note">Μονάδες: mm</span>
          <button
            type="button"
            className="theme-toggle"
            aria-pressed={theme === 'dark'}
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          >
            {theme === 'dark' ? '☀ Φωτεινό' : '☾ Σκοτεινό'}
          </button>
        </div>
      </header>

      <main className={`app-main${pane === 'sheet' ? ' sheet-mode' : ''}`}>
        <section
          ref={viewerPaneRef}
          className={`viewer-pane${cssFullscreen ? ' css-fullscreen' : ''}${fullscreen && pane === 'sheet' ? ' sheet-full' : ''}`}
          aria-label="Προβολή"
        >
          {/* Πλήρης οθόνη φύλλου: μόνο το χαρτί, και ένα κουμπί για έξοδο. */}
          {fullscreen && pane === 'sheet' && (
            <button type="button" className="sheet-exit" onClick={toggleFullscreen} aria-label="Έξοδος από πλήρη οθόνη" title="Έξοδος (Esc)">
              ✕
            </button>
          )}
          <div className="pane-header">
          <div className="segmented pane-switch" role="tablist" aria-label="Προβολή" data-pane={pane}>
            <button type="button" role="tab" aria-selected={pane === '3d'} onClick={() => setPane('3d')}>
              3D
            </button>
            <button type="button" role="tab" aria-selected={pane === 'sheet'} onClick={() => {
                setPane('sheet');
                setScaleOpen(false);
              }}>
              Φύλλο όψεων
            </button>
          </div>
          <button
            type="button"
            className="secondary-button fullscreen-button"
            aria-pressed={fullscreen}
            onClick={toggleFullscreen}
            title={fullscreen ? 'Έξοδος από πλήρη οθόνη (Esc)' : 'Πλήρης οθόνη'}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {fullscreen ? (
                <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
              ) : (
                <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
              )}
            </svg>
            <span>{fullscreen ? 'Έξοδος' : 'Πλήρης οθόνη'}</span>
          </button>
          </div>
          {pane === 'sheet' && (
            <SheetView
              part={sheetBlocked ? null : viewerPart}
              blockedReason={sheetBlocked}
              projection={projection}
              openMesh={openMesh}
              fileName={(fileMode && file ? file.raw.name.replace(/\.[^.]+$/, '') : template.id) || 'sxedio'}
              scale={sheetScale}
              onSuggestedScale={applySuggestedScale}
              title={fileMode && file ? file.raw.name.replace(/\.[^.]+$/, '') : nameOf(template)}
            />
          )}
          <div className="viewer" hidden={pane !== '3d'}>
            <Viewer
              ref={viewerRef}
              part={viewerPart}
              scale={viewerScale}
              dimsMode={effectiveDims}
              showHidden={showHidden}
              colorMode={colorMode}
              theme={theme}
              shape={{ key: shapeKey, index: fileMode ? -1 : orderedTemplates.findIndex((t) => t.id === templateId) }}
              onViewChange={setView}
            />
            <div className="chip chip-view" aria-live="polite">
              Όψη: <strong>{viewLabel(view)}</strong>
            </div>
            <button
              ref={scaleChipRef}
              type="button"
              className={`chip chip-scale chip-button${scaleOpen ? ' open' : ''}`}
              aria-expanded={scaleOpen}
              aria-controls="scale-popover"
              aria-label={`Κλίμακα 3D: ${scaleLabel(viewerScale)}. Πάτα για αλλαγή.`}
              onClick={() => setScaleOpen((o) => !o)}
            >
              Κλίμακα <strong>{scaleLabel(viewerScale)}</strong> <span className="chevron" aria-hidden="true">▾</span>
              {viewerScale.n !== 1 && <span className="chip-sub">{scaleHint(viewerScale)}</span>}
            </button>
            {scaleOpen && (
              <div ref={scalePopoverRef} id="scale-popover" className="scale-popover" role="dialog" aria-label="Κλίμακα 3D">
                <h2>Κλίμακα 3D</h2>
                <ScaleSelector key={shapeKey} value={viewerScale} onChange={setScale} />
              </div>
            )}
            {!fileMode && stale && (
              <div className="stale-banner" role="status">
                Τα μέτρα έχουν σφάλμα — εμφανίζεται το τελευταίο έγκυρο σχήμα.
              </div>
            )}
            {fileMode && file && !fileOptions.confirmed && (
              <div className="info-banner" role="status">
                Διάλεξε μονάδα και πάνω άξονα και πάτα «Επιβεβαίωση» για να εμφανιστούν οι διαστάσεις.
              </div>
            )}
            {fileMode && !file && (
              <div className="viewer-empty">
                <p>{loadingName ? `Φόρτωση «${loadingName}»…` : 'Δεν έχει ανοίξει αρχείο 3D.'}</p>
                {!loadingName && <FilePicker onFiles={(f) => void openFiles(f)} />}
              </div>
            )}
          </div>
          {pane === '3d' && (
            <ViewToolbar
              current={view}
              onSelect={(v) => viewerRef.current?.goTo(v)}
              onFit={() => viewerRef.current?.fit()}
            />
          )}
        </section>

        <aside className="side-pane">
          <section className="card">
            <div className="segmented mode-switch" role="radiogroup" aria-label="Τρόπος εισαγωγής">
              <button type="button" role="radio" aria-checked={!fileMode} onClick={() => setMode('template')}>
                Έτοιμο σχήμα
              </button>
              <button type="button" role="radio" aria-checked={fileMode} onClick={() => setMode('file')}>
                Αρχείο 3D
              </button>
            </div>
            {fileMode ? (
              <FilePanel
                file={file}
                options={fileOptions}
                loadingName={loadingName}
                error={fileError}
                onFiles={(f) => void openFiles(f)}
                onChange={(patch) => setFileOptions((o) => ({ ...o, ...patch(o) }))}
                onClose={() => {
                  setFile(null);
                  setFileError(null);
                  setFileOptions(NO_OPTIONS);
                }}
              />
            ) : (
              <>
                <TemplatePicker
                  templates={orderedTemplates}
                  nameOf={nameOf}
                  value={templateId}
                  onChange={setTemplateId}
                  onReorder={setTemplateOrder}
                  onRename={(id, name) =>
                    setTemplateNames((prev) => {
                      const next = { ...prev };
                      if (name) next[id] = name;
                      else delete next[id];
                      return next;
                    })
                  }
                />
                <p className="hint">Σύρε το ⠿ για να αλλάξεις σειρά· ✎ για μετονομασία.</p>
                <ParamForm
                  key={template.id}
                  open={paramsOpen}
                  onOpenChange={setParamsOpen}
                  template={template}
                  inputs={inputs[template.id]}
                  toggles={toggles[template.id]}
                  evaluation={evaluation}
                  onInput={(key, value) =>
                    setInputs((prev) => ({ ...prev, [template.id]: { ...prev[template.id], [key]: value } }))
                  }
                  onToggle={(key, value) =>
                    setToggles((prev) => ({ ...prev, [template.id]: { ...prev[template.id], [key]: value } }))
                  }
                  onReset={() => {
                    setInputs((prev) => ({ ...prev, [template.id]: defaultInputs(template) }));
                    setToggles((prev) => ({ ...prev, [template.id]: defaultToggles(template) }));
                  }}
                />
              </>
            )}
          </section>

          {/* Η κλίμακα του 3D αλλάζει από το κουμπί «Κλίμακα» πάνω δεξιά στην προβολή. */}
          {pane === 'sheet' && (
            <section className="card">
              <h2>Κλίμακα φύλλου όψεων</h2>
              <ScaleSelector key={shapeKey} value={sheetScale} onChange={setScale} />
            </section>
          )}

          {pane === '3d' && (
            <section className="card">
              <h2>Εμφάνιση στο 3D</h2>
              <div className="toggle-buttons">
                <button
                  type="button"
                  className={`secondary-button color-mode${showHidden ? ' on' : ''}`}
                  aria-pressed={showHidden}
                  onClick={() => setShowHidden((v) => !v)}
                >
                  Διακεκομμένες γραμμές: {showHidden ? 'ON' : 'OFF'}
                </button>
                <button
                  type="button"
                  className={`secondary-button color-mode${colorMode ? ' on' : ''}`}
                  aria-pressed={colorMode}
                  onClick={() => setColorMode((c) => !c)}
                >
                  Χρώματα όψεων: {colorMode ? 'ON' : 'OFF'}
                </button>
              </div>
              {showHidden && edgeCount > 10000 && (
                <p className="warning">Το μοντέλο έχει {edgeCount.toLocaleString('el-GR')} ακμές· η προβολή μπορεί να είναι πιο αργή.</p>
              )}
              {showHidden && openMesh && <p className="warning">Οι διακεκομμένες γραμμές ίσως δεν είναι ακριβείς για ανοιχτά πλέγματα.</p>}
              {colorMode && (
                <ul className="color-legend">
                  <li><i style={{ background: FACE_COLORS.top }} />Κάτοψη (πάνω)</li>
                  <li><i style={{ background: FACE_COLORS.front }} />Πρόσοψη (μπροστά)</li>
                  <li><i style={{ background: FACE_COLORS.side }} />Πλάγια (αριστερά)</li>
                  <li><i style={{ background: FACE_COLORS.other }} />Υπόλοιπες έδρες</li>
                </ul>
              )}
              <p className="field-label">Ετικέτες διαστάσεων</p>
              <div className="segmented" role="radiogroup" aria-label="Ετικέτες διαστάσεων">
                {DIMS_MODES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    role="radio"
                    aria-checked={dimsMode === m.id}
                    onClick={() => setDimsMode(m.id)}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </section>
          )}
        </aside>
      </main>

      <PwaBanner />

      {dragging && (
        <div className="drag-overlay" aria-hidden="true">
          <p>Άφησε το αρχείο για να ανοίξει</p>
          <span>Μένει στη συσκευή σου, δεν ανεβαίνει πουθενά.</span>
        </div>
      )}
    </div>
  );
}
