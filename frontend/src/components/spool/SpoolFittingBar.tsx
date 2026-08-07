/**
 * The fittings strip: what the run says sits between the two picked girth
 * welds, and the controls to correct it.
 *
 * An ILI run is far more reliable about a bend being present than about its
 * angle — many exports carry no angle at all. So the pane draws 90° when
 * nothing was reported, says so on the chip, and lets the engineer set the
 * angle, the direction of the turn, and the fitting type. A drawn angle nobody
 * measured must never read as measured evidence.
 */

import { FiCornerUpRight, FiEye, FiEyeOff, FiRotateCcw } from 'react-icons/fi';

import {
  BEND_ANGLE_CHOICES,
  FITTING_LABEL,
  ROLL_CHOICES,
  type SpoolFitting,
  type SpoolFittingKind,
  type SpoolFittingOverride,
} from './spoolFittings.ts';

interface SpoolFittingBarProps {
  fittings: SpoolFitting[];
  showFittings: boolean;
  onToggleFittings: () => void;
  onChange: (key: string, override: SpoolFittingOverride) => void;
  onReset: (key: string) => void;
  onFocus: (fitting: SpoolFitting) => void;
}

const KIND_CHOICES: SpoolFittingKind[] = ['bend', 'tee', 'valve', 'flange', 'other'];

export default function SpoolFittingBar({
  fittings,
  showFittings,
  onToggleFittings,
  onChange,
  onReset,
  onFocus,
}: SpoolFittingBarProps) {
  return (
    <div className="spool-view__fittings">
      <div className="spool-view__fittings-head">
        <FiCornerUpRight aria-hidden="true" />
        <strong>Fittings in this spool</strong>
        <span>{fittings.length} between the picked welds — the shell follows them</span>
        <button
          type="button"
          className={`ds-btn ds-btn--xs ${showFittings ? 'ds-btn--primary' : 'ds-btn--ghost'}`}
          onClick={onToggleFittings}
          title="Draw valve bodies, tee branches and flanges on the pipe"
        >
          {showFittings ? <FiEye /> : <FiEyeOff />} Bodies
        </button>
      </div>

      <ul className="spool-view__fittings-list">
        {fittings.map((fitting) => (
          <li key={fitting.key} className="spool-fitting">
            <button
              type="button"
              className="spool-fitting__title"
              onClick={() => onFocus(fitting)}
              title="Select this fitting in every pane"
            >
              <strong>{fitting.label || FITTING_LABEL[fitting.kind]}</strong>
              <span>{fitting.maM.toFixed(2)} m</span>
            </button>

            <label className="spool-fitting__field">
              <span>Type</span>
              <select
                className="ds-select ds-select--sm"
                value={fitting.kind}
                onChange={(event) => onChange(fitting.key, {
                  kind: event.target.value as SpoolFittingKind,
                })}
              >
                {KIND_CHOICES.map((kind) => (
                  <option key={kind} value={kind}>{FITTING_LABEL[kind]}</option>
                ))}
              </select>
            </label>

            {fitting.kind === 'bend' && (
              <>
                <div className="spool-fitting__angles" role="group" aria-label={`Bend angle at ${fitting.maM.toFixed(2)} m`}>
                  {BEND_ANGLE_CHOICES.map((angle) => (
                    <button
                      key={angle}
                      type="button"
                      className={`ds-btn ds-btn--xs ${fitting.angleDeg === angle ? 'ds-btn--primary' : 'ds-btn--ghost'}`}
                      onClick={() => onChange(fitting.key, { angleDeg: angle })}
                    >
                      {angle}°
                    </button>
                  ))}
                </div>
                <label className="spool-fitting__field">
                  <span>Turns towards</span>
                  <select
                    className="ds-select ds-select--sm"
                    value={ROLL_CHOICES.find(([, deg]) => deg === fitting.rollDeg)?.[1] ?? ''}
                    onChange={(event) => onChange(fitting.key, { rollDeg: Number(event.target.value) })}
                  >
                    {!ROLL_CHOICES.some(([, deg]) => deg === fitting.rollDeg) && (
                      <option value="">{`${fitting.rollDeg.toFixed(0)}° (reported clock)`}</option>
                    )}
                    {ROLL_CHOICES.map(([label, deg]) => (
                      <option key={deg} value={deg}>{label}</option>
                    ))}
                  </select>
                </label>
                {fitting.angleAssumed && (
                  <span className="spool-fitting__warn" title="The run reported no bend angle">
                    angle assumed
                  </span>
                )}
              </>
            )}

            {fitting.isOverridden && (
              <button
                type="button"
                className="ds-btn ds-btn--xs ds-btn--ghost"
                onClick={() => onReset(fitting.key)}
                title="Go back to what the run reported"
              >
                <FiRotateCcw /> Reset
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
