import { useMemo, useState } from 'react';
import { FiCornerUpRight, FiGitCommit, FiRepeat, FiZap } from 'react-icons/fi';

import { Button, Callout, Input, Panel, PanelBody, PanelHeader } from '../components/ds';
import type { LockedGwPair, MatchingSection } from '../wizard/matchingSections';
import {
  autoSectionsAtBoundaries,
  autoSectionsByLength,
  fillCoverageGaps,
  coverageGaps,
} from './sectionBuilder';
import type { SpatialFeature } from './types';

interface Props {
  lockedGws: LockedGwPair[];
  sections: MatchingSection[];
  /** Physical features usable as boundaries, already restricted to the master run. */
  features: SpatialFeature[];
  onApply: (sections: MatchingSection[]) => void;
}

const isKind = (feature: SpatialFeature, needle: string) => feature.type.toLowerCase().includes(needle);

/**
 * One-click layouts. Everything produced here is an ordinary editable section —
 * the presets remove the repetitive manual work, they do not lock anything in.
 */
export default function AutoSectionPresets({ lockedGws, sections, features, onApply }: Props) {
  const [spanKm, setSpanKm] = useState('1');
  const [confirming, setConfirming] = useState<string | null>(null);

  const bends = useMemo(() => features.filter((feature) => isKind(feature, 'bend')), [features]);
  const valves = useMemo(
    () => features.filter((feature) => isKind(feature, 'valve') || isKind(feature, 'tee')),
    [features],
  );
  const gaps = useMemo(() => coverageGaps(sections, lockedGws), [lockedGws, sections]);

  const spanM = Number(spanKm.replace(',', '.')) * 1000;
  const spanValid = Number.isFinite(spanM) && spanM > 0;

  const replace = (next: MatchingSection[], key: string) => {
    // Replacing an existing layout throws away manual work, so ask once.
    if (sections.length > 0 && confirming !== key) {
      setConfirming(key);
      return;
    }
    setConfirming(null);
    onApply(next);
  };

  const uniform = () => replace(autoSectionsByLength(lockedGws, spanM, { name: 'Section', sectionType: 'BUR', policy: 'MATCH' }), 'uniform');
  const perBend = () => replace(
    autoSectionsAtBoundaries(lockedGws, bends.map((bend) => bend.dist), { name: 'Bend span', sectionType: 'BUR', policy: 'MATCH' }),
    'bend',
  );
  const valveToValve = () => replace(
    autoSectionsAtBoundaries(lockedGws, valves.map((valve) => valve.dist), { name: 'Valve span', sectionType: 'BUR', policy: 'MATCH' }),
    'valve',
  );
  // Filling gaps is additive, so it never needs the confirmation step.
  const fillGaps = () => onApply(fillCoverageGaps(sections, lockedGws));

  return (
    <Panel quiet>
      <PanelHeader
        plain
        icon={<FiZap aria-hidden="true" />}
        eyebrow="Auto-section"
        title="Build a layout in one click"
        subtitle="Every generated section stays editable — rename, retype, or delete them afterwards."
      />
      <PanelBody className="ds-stack">
        {confirming && (
          <Callout tone="warning" title="This replaces the current layout">
            {sections.length} existing section{sections.length === 1 ? '' : 's'} will be discarded. Press the
            same button again to confirm, or pick a different preset.
          </Callout>
        )}

        <div className="sec-presets">
          <div className="sec-presets__item">
            <div className="sec-presets__copy">
              <strong>Uniform length</strong>
              <small>Split the line into even spans, snapped to real welds.</small>
            </div>
            <div className="ds-row" style={{ flexWrap: 'nowrap' }}>
              <Input
                small
                data
                inputMode="decimal"
                aria-label="Uniform section length in kilometres"
                value={spanKm}
                onChange={(event) => setSpanKm(event.target.value)}
                style={{ width: '4.5rem' }}
              />
              <span className="ds-toolbar__hint">km</span>
              <Button
                size="sm"
                variant={confirming === 'uniform' ? 'primary' : 'secondary'}
                startIcon={<FiRepeat aria-hidden="true" />}
                disabled={!spanValid || lockedGws.length < 2}
                onClick={uniform}
              >
                {confirming === 'uniform' ? 'Confirm' : 'Apply'}
              </Button>
            </div>
          </div>

          <div className="sec-presets__item">
            <div className="sec-presets__copy">
              <strong>Split at bends</strong>
              <small>{bends.length} bend{bends.length === 1 ? '' : 's'} detected on the master run.</small>
            </div>
            <Button
              size="sm"
              variant={confirming === 'bend' ? 'primary' : 'secondary'}
              startIcon={<FiGitCommit aria-hidden="true" />}
              disabled={bends.length === 0}
              onClick={perBend}
            >
              {confirming === 'bend' ? 'Confirm' : 'Apply'}
            </Button>
          </div>

          <div className="sec-presets__item">
            <div className="sec-presets__copy">
              <strong>Valve to valve</strong>
              <small>{valves.length} valve/tee boundar{valves.length === 1 ? 'y' : 'ies'} available.</small>
            </div>
            <Button
              size="sm"
              variant={confirming === 'valve' ? 'primary' : 'secondary'}
              startIcon={<FiGitCommit aria-hidden="true" />}
              disabled={valves.length === 0}
              onClick={valveToValve}
            >
              {confirming === 'valve' ? 'Confirm' : 'Apply'}
            </Button>
          </div>

          <div className="sec-presets__item">
            <div className="sec-presets__copy">
              <strong>Fill remaining gaps</strong>
              <small>
                {gaps.length === 0
                  ? 'The line is fully covered.'
                  : `${gaps.length} uncovered stretch${gaps.length === 1 ? '' : 'es'} left.`}
              </small>
            </div>
            <Button
              size="sm"
              variant="secondary"
              startIcon={<FiCornerUpRight aria-hidden="true" />}
              disabled={gaps.length === 0}
              onClick={fillGaps}
            >
              Fill
            </Button>
          </div>
        </div>
      </PanelBody>
    </Panel>
  );
}
