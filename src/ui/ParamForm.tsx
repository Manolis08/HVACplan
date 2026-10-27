import { formatNumber } from '../lib/format';
import type { Evaluation } from '../model/evaluate';
import type { TemplateDef, Toggles } from '../model/types';
import { Icon } from './Icon';

interface Props {
  template: TemplateDef;
  inputs: Record<string, string>;
  toggles: Toggles;
  evaluation: Evaluation;
  onInput: (key: string, value: string) => void;
  onToggle: (key: string, value: boolean) => void;
  onReset: () => void;
  /** Τα πεδία μέτρων είναι κρυμμένα μέχρι να πατηθεί το κουμπί (πιάνουν πολύ χώρο). */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ParamForm({ template, inputs, toggles, evaluation, onInput, onToggle, onReset, open, onOpenChange }: Props) {
  const { fieldErrors, issues, locked, values, part } = evaluation;
  const issueFields = new Set(issues.flatMap((i) => i.fields));

  return (
    <div className="param-form">
      <button
        type="button"
        className={`secondary-button params-toggle${open ? ' open' : ''}`}
        aria-expanded={open}
        aria-controls={`params-${template.id}`}
        onClick={() => onOpenChange(!open)}
      >
        <span>{open ? 'Απόκρυψη διαστάσεων' : 'Αλλαγή διαστάσεων'}</span>
        <Icon name="chevron" size={14} className="chevron" />
      </button>

      <div id={`params-${template.id}`} className={`collapsible${open ? ' open' : ''}`} inert={!open}>
        <div className="collapsible-inner">
          <p className="form-note">Πραγματικά μέτρα σε mm. Η κλίμακα δεν τα αλλάζει.</p>

          {template.toggles?.map((tg) => (
            <label key={tg.key} className="toggle">
              <input type="checkbox" checked={!!toggles[tg.key]} onChange={(e) => onToggle(tg.key, e.target.checked)} />
              <span>{tg.label}</span>
            </label>
          ))}

          <div className="fields">
            {template.params.map((p) => {
              const id = `param-${template.id}-${p.key}`;
              const isLocked = locked.has(p.key);
              const error = fieldErrors[p.key];
              const invalid = !!error || issueFields.has(p.key);
              return (
                <div key={p.key} className="field">
                  <label htmlFor={id}>
                    {p.label}
                    {p.axis && <span className="axis-tag">{p.axis}</span>}
                  </label>
                  <div className={`input-wrap${invalid ? ' invalid' : ''}${isLocked ? ' locked' : ''}`}>
                    <input
                      id={id}
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      enterKeyHint="next"
                      value={isLocked ? formatNumber(values[p.key] ?? 0) : (inputs[p.key] ?? '')}
                      disabled={isLocked}
                      aria-invalid={invalid}
                      aria-describedby={error ? `${id}-err` : undefined}
                      onChange={(e) => onInput(p.key, e.target.value)}
                    />
                    {p.signed && !isLocked && (
                      <button
                        type="button"
                        className="sign-button"
                        aria-label={`Αλλαγή προσήμου: ${p.label}`}
                        onClick={() => {
                          const v = (inputs[p.key] ?? '').trim();
                          onInput(p.key, v.startsWith('-') || v.startsWith('−') ? v.slice(1) : `-${v}`);
                        }}
                      >
                        ±
                      </button>
                    )}
                    <span className="unit">mm</span>
                  </div>
                  {isLocked && <p className="field-hint">Αυτόματα (στο κέντρο)</p>}
                  {error && (
                    <p id={`${id}-err`} className="field-error">
                      {error}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          {part && part.info.length > 0 && (
            <dl className="info">
              {part.info.map((i) => (
                <div key={i.label}>
                  <dt>{i.label}</dt>
                  <dd>
                    {formatNumber(i.value)}
                    {i.unit === '°' ? '°' : ' mm'}
                  </dd>
                </div>
              ))}
            </dl>
          )}

          <button type="button" className="link-button" onClick={onReset}>
            Επαναφορά προεπιλογών
          </button>
        </div>
      </div>

      {/* Τα σφάλματα φαίνονται πάντα, ακόμα κι όταν τα πεδία είναι κρυμμένα. */}
      {issues.length > 0 && (
        <div className="issues" role="alert">
          {issues.map((i, n) => (
            <p key={n}>{i.message}</p>
          ))}
        </div>
      )}
    </div>
  );
}
