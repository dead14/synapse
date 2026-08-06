import { useState } from 'react';
import {
  FiCheckCircle,
  FiChevronLeft,
  FiChevronRight,
  FiEye,
  FiEyeOff,
  FiFilter,
  FiInfo,
  FiLock,
} from 'react-icons/fi';

import {
  ActionBar,
  Button,
  Callout,
  Panel,
  PanelBody,
  PanelHeader,
} from '../components/ds';
import { buildFeatureRulesConfig, TOGGLEABLE_FEATURE_TYPES } from './matchingRules';

interface StepFeatureRulesProps {
  onNext: (config: any) => void;
  onBack: () => void;
  config?: any;
}

const EVIDENCE = [
  {
    title: 'GW and landmark rows',
    body: 'Used by the anchor phase and retained in the final table.',
  },
  {
    title: 'Metal-loss anomalies',
    body: 'Eligible for Hungarian matching within locked GW sections.',
  },
  {
    title: 'Invalid or outside-domain rows',
    body: 'Never silently dropped; emitted as Filtered OLD/NEW evidence.',
  },
];

export default function StepFeatureRules({ onNext, onBack, config }: StepFeatureRulesProps) {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(config?.hiddenFeatures ?? []));

  const toggle = (key: string) => {
    setHidden((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const hiddenCount = hidden.size;

  return (
    <div className="ds-stack ds-stack--lg animate-fade-in">
      <Panel>
        <PanelHeader
          icon={<FiFilter aria-hidden="true" />}
          eyebrow="Feature rules"
          title="What the matcher reads, and what the report shows"
          subtitle="Candidate eligibility is fixed by the engine. Visibility only controls the report."
          actions={
            hiddenCount > 0 ? (
              <Button variant="secondary" size="sm" onClick={() => setHidden(new Set())}>
                Show all
              </Button>
            ) : undefined
          }
        />

        <PanelBody className="ds-stack ds-stack--lg">
          <div className="matching-rule-evidence">
            {EVIDENCE.map((item) => (
              <article key={item.title}>
                <FiCheckCircle aria-hidden="true" />
                <div>
                  <strong>{item.title}</strong>
                  <span>{item.body}</span>
                </div>
              </article>
            ))}
          </div>

          <Callout tone="info" icon={<FiInfo aria-hidden="true" />}>
            Hiding a structural type does not change matching. Bends, valves, and tees never enter
            the anomaly cost matrix — the engine pairs them separately as pipe furniture. These
            switches only keep them out of the report table.
          </Callout>

          <div className="feature-rules">
            <div className="feature-rules__group">
              <p className="feature-rules__caption">Always shown</p>
              <div className="feature-rules__list">
                {['Metal loss', 'Welds'].map((label) => (
                  <div key={label} className="feature-row feature-row--locked">
                    <FiLock aria-hidden="true" />
                    <span>{label}</span>
                    <FiEye aria-hidden="true" className="feature-row__state feature-row__state--on" />
                  </div>
                ))}
              </div>
              <p className="feature-rules__note">
                The matched anomalies and the girth welds that anchor them are the report.
              </p>
            </div>

            <div className="feature-rules__group">
              <p className="feature-rules__caption">
                Optional
                {hiddenCount > 0 && <span className="feature-rules__count">{hiddenCount} hidden</span>}
              </p>
              <div className="feature-rules__list">
                {TOGGLEABLE_FEATURE_TYPES.map(({ key, label }) => {
                  const isHidden = hidden.has(key);
                  return (
                    <label key={key} className={`feature-row${isHidden ? ' is-hidden' : ''}`}>
                      <input type="checkbox" checked={!isHidden} onChange={() => toggle(key)} />
                      <span>{label}</span>
                      {isHidden
                        ? <FiEyeOff aria-hidden="true" className="feature-row__state feature-row__state--off" />
                        : <FiEye aria-hidden="true" className="feature-row__state feature-row__state--on" />}
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        </PanelBody>
      </Panel>

      <ActionBar
        back={
          <Button variant="ghost" startIcon={<FiChevronLeft aria-hidden="true" />} onClick={onBack}>
            Sectioning
          </Button>
        }
        next={
          <Button
            endIcon={<FiChevronRight aria-hidden="true" />}
            onClick={() => onNext(buildFeatureRulesConfig([...hidden]))}
          >
            Tolerances
          </Button>
        }
      />
    </div>
  );
}
