import { formatNumber } from '../lib/format';
import type { Evaluation } from '../model/evaluate';
import type { TemplateDef, Toggles } from '../model/types';

interface Props {
  template: TemplateDef;
  inputs: Record<string, string>;
  toggles: Toggles;
  evaluation: Evaluation;
  onInput: (key: string, value: string) => void;
  onToggle: (key: string, value: boolean) => void;
  onReset: () => void;
}

export function ParamForm({ template, inputs, toggles, evaluation, onInput, onToggle, onReset }: Props) {
  const { fieldErrors, issues, locked, values, part } = evaluation;
  const issueFields = new Set(issues.flatMap((i) => i.fields));

  return (
    <div className="param-form">
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

      {issues.length > 0 && (
        <div className="issues" role="alert">
          {issues.map((i, n) => (
            <p key={n}>{i.message}</p>
          ))}
        </div>
      )}

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
  );
}
