import { useState } from 'react';
import { FiAlertTriangle, FiCheckCircle, FiDownload, FiInfo, FiPlus, FiTarget, FiMap } from 'react-icons/fi';

import {
  ActionBar,
  Badge,
  Button,
  Callout,
  Field,
  Input,
  MathBlock,
  MathInline,
  Panel,
  PanelBody,
  PanelHeader,
  Segmented,
  Select,
  SliderField,
  Stat,
  StatGrid,
  Switch,
} from '../components/ds';
import SectionRangeBrush from '../sectioning/SectionRangeBrush';
import { failureStressTex, FFS_TEX } from '../lib/ffs/notation';
import { RBI_TEX } from '../lib/rbi/notation';
import { ALIGNMENT_TEX } from '../lib/alignment/notation';
import type { LockedGwPair } from '../wizard/matchingSections';
import ClockRose from '../components/corrosion/ClockRose';
import DepthHistogram from '../components/corrosion/DepthHistogram';
import DepthLengthEnvelope from '../components/corrosion/DepthLengthEnvelope';
import KpDensity from '../components/corrosion/KpDensity';
import RemainingLife from '../components/corrosion/RemainingLife';
import ReviewQueue from '../components/corrosion/ReviewQueue';
import SegmentSeverity from '../components/corrosion/SegmentSeverity';
import type { CorrosionFeature } from '../lib/corrosion/analysis';

/**
 * Living reference for the design system — dev-only, mounted at /ds-preview.
 *
 * Every control the alignment wizard uses is on this page, so a regression in
 * sizing or colour shows up here before it reaches a step.
 */

const MOCK_GWS: LockedGwPair[] = Array.from({ length: 61 }, (_, index) => ({
  key: `k${index}`,
  oldId: `OLD-${1000 + index}`,
  newId: `GW-${1500 + index}`,
  oldDistance: index * 205,
  newDistance: index * 208,
}));

const VARIANTS = ['primary', 'secondary', 'soft', 'ghost', 'danger', 'danger-solid'] as const;
const SIZES = ['xs', 'sm', 'md', 'lg'] as const;

const SECTIONS = ['Buried S-17', 'River crossing RC-04', 'Road crossing CR-09', 'Aerial AE-02', 'Transition TR-01'];

/**
 * Synthetic corrosion population, shaped like a real run: mostly shallow with a
 * long tail, internal loss clustered along the invert, and a density hotspot.
 */
const MOCK_FEATURES: CorrosionFeature[] = Array.from({ length: 420 }, (_, index) => {
  const rand = (seed: number) => ((Math.sin(index * 12.9898 + seed) * 43758.5453) % 1 + 1) % 1;
  const internal = rand(1) < 0.62;
  // Internal loss sits low in the bore; external gathers on the crown.
  const hour = internal ? 4 + rand(2) * 4 : (10 + rand(3) * 4) % 12;
  const depth = Math.min(92, 6 + rand(4) ** 2.4 * 80);
  const clustered = rand(5) < 0.35;
  const distance = clustered ? 4200 + rand(6) * 900 : rand(7) * 12400;
  const growth = rand(8) < 0.18 ? -0.4 + rand(9) * 0.4 : rand(10) ** 2 * 2.4;

  return {
    sourceKey: `k-${index}`,
    featureId: `ML-25-${String(1000 + index).padStart(6, '0')}`,
    section: SECTIONS[Math.floor(rand(11) * SECTIONS.length)],
    featureType: 'Metal Loss',
    distanceM: distance,
    clock: `${Math.floor(hour) === 0 ? 12 : Math.floor(hour)}:${String(Math.floor((hour % 1) * 60)).padStart(2, '0')}`,
    surface: internal ? 'Internal' : 'External',
    depthPct: depth,
    lengthMm: 12 + rand(12) * 180,
    widthMm: 8 + rand(13) * 60,
    wallMm: 9.5,
    depthGrowthPctWtPerYear: growth,
    lengthGrowthMmPerYear: null,
    erf: 0.4 + (depth / 100) * 0.9,
    psafeBar: null,
    matchStatus: rand(14) < 0.25 ? 'Unmatched' : 'Matched',
    physicsWarning: '-',
    growthClass: growth >= 0.5 ? 'active' : growth > 0 ? 'possibly-active' : 'stable',
    ffsReady: rand(15) > 0.08,
    blockers: rand(15) > 0.08 ? [] : ['No reported width'],
  };
});

export default function DesignSystemPage() {
  const [range, setRange] = useState<{ startIndex: number; endIndex: number } | null>({ startIndex: 12, endIndex: 28 });
  const [mode, setMode] = useState<'schematic' | 'map'>('schematic');
  const [toggle, setToggle] = useState(true);
  const [slider, setSlider] = useState(1.5);

  return (
    <div className="ds-stack ds-stack--lg" style={{ padding: '1.25rem', maxWidth: '78rem', margin: '0 auto' }}>
      <Panel>
        <PanelHeader
          icon={<FiTarget aria-hidden="true" />}
          eyebrow="Reference"
          title="Synapse design system"
          subtitle="One geometry scale, one palette. Alignment steps render through these primitives."
          actions={<Badge tone="primary">dev only</Badge>}
        />
      </Panel>

      <Panel>
        <PanelHeader plain eyebrow="Buttons" title="Every variant at every size" />
        <PanelBody className="ds-stack">
          {SIZES.map((size) => (
            <div key={size} className="ds-row">
              <span className="ds-toolbar__label" style={{ width: '2.5rem' }}>{size}</span>
              {VARIANTS.map((variant) => (
                <Button key={variant} variant={variant} size={size}>
                  {variant}
                </Button>
              ))}
              <Button size={size} disabled>disabled</Button>
              <Button size={size} variant="secondary" iconOnly aria-label="Add"><FiPlus aria-hidden="true" /></Button>
            </div>
          ))}
          <div className="ds-row">
            <Button startIcon={<FiDownload aria-hidden="true" />}>With start icon</Button>
            <Button variant="secondary" endIcon={<FiTarget aria-hidden="true" />}>With end icon</Button>
            <Segmented<'schematic' | 'map'>
              ariaLabel="Viewer mode"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'schematic', label: 'GW view', icon: <FiTarget aria-hidden="true" /> },
                { value: 'map', label: 'Maps', icon: <FiMap aria-hidden="true" /> },
              ]}
            />
            <Switch checked={toggle} onChange={setToggle} label="Example toggle" />
          </div>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader plain eyebrow="Feedback" title="Status tones" />
        <PanelBody className="ds-stack">
          <div className="ds-row">
            <Badge>neutral</Badge>
            <Badge tone="primary">primary</Badge>
            <Badge tone="success">success</Badge>
            <Badge tone="warning">warning</Badge>
            <Badge tone="danger">danger</Badge>
          </div>
          <Callout tone="info" icon={<FiInfo aria-hidden="true" />} title="Informational">
            Explains a rule the operator needs before acting.
          </Callout>
          <Callout tone="success" icon={<FiCheckCircle aria-hidden="true" />} title="Ready" meta="0 invalid">
            Both persisted runs contain feature and anchor evidence.
          </Callout>
          <Callout tone="warning" icon={<FiAlertTriangle aria-hidden="true" />} title="Needs attention" meta="24 joints">
            Joints exceeding the OTA should be reviewed before continuing.
          </Callout>
          <Callout tone="danger" icon={<FiAlertTriangle aria-hidden="true" />} title="Blocked">
            Sections must not overlap.
          </Callout>
          <StatGrid>
            <Stat label="Total features" value="4,835" hint="Master run" />
            <Stat label="GW anchors" value="1,146" hint="Reference points" />
            <Stat label="Matched" value="92.3%" tone="success" />
            <Stat label="Review queue" value="24" tone="warning" />
            <Stat label="Missing" value="66" tone="danger" />
          </StatGrid>
        </PanelBody>
      </Panel>

      {/* Notation is a design-system concern, not an FFS one: the same
          primitives set the B31G working, the alignment evidence and the RBI
          screening rules, and if they are not the same size as the prose beside
          them on this page they will not be on any of those either. */}
      <Panel>
        <PanelHeader
          plain
          eyebrow="Notation"
          title="Typeset mathematics"
          subtitle="MathJax through the design system. Every equation inherits the font size around it."
        />
        <PanelBody className="ds-stack">
          <p style={{ fontSize: 'var(--ds-t-base)', color: 'var(--ds-ink-soft)', margin: 0 }}>
            Inline, inside a sentence: the estimating repair factor{' '}
            <MathInline tex={FFS_TEX.erf} label="ERF equals P zero over P safe" /> is an operator
            convention, and a feature is accepted while{' '}
            <MathInline tex="\ERF < 1" label="ERF below one" />. Text style keeps the fraction on one
            line so the paragraph leading does not jump.
          </p>

          <MathBlock
            tex={failureStressTex('modified')}
            label="Modified B31G failure stress"
            tag="B31G para. 2.2"
          />
          <MathBlock tex={ALIGNMENT_TEX.logBayesFactor} label="total log Bayes factor" tag="Alignment" />
          <MathBlock tex={RBI_TEX.interval} label="inspection interval" tag="API 580" />

          {/* The three scales side by side. `md` is the contract — same size as
              the text — and the other two exist for the two places the contract
              is wrong: a tall expression inside a dense table row, and a
              governing result that has to be found from across the room. */}
          <div className="ds-row" style={{ alignItems: 'flex-end', gap: '1.5rem' }}>
            {(['sm', 'md', 'lg'] as const).map((scale) => (
              <div key={scale}>
                <p className="ds-muted" style={{ fontSize: 'var(--ds-t-micro)', margin: 0 }}>
                  scale {scale}
                </p>
                <MathInline tex={FFS_TEX.safePressure} scale={scale} label="safe pressure" />
              </div>
            ))}
          </div>

          {/* Proportion, demonstrated rather than asserted: one expression at
              four surrounding type sizes, with no size of its own anywhere. */}
          <div className="ds-stack" style={{ gap: '0.4rem' }}>
            {([
              ['--ds-t-xs', 'table cell'],
              ['--ds-t-base', 'body'],
              ['--ds-t-lg', 'section heading'],
              ['--ds-t-xl', 'page title'],
            ] as const).map(([token, where]) => (
              <p key={token} style={{ fontSize: `var(${token})`, margin: 0 }}>
                {where} — <MathInline tex={FFS_TEX.normalisedLength} label="normalised length" />
              </p>
            ))}
          </div>

          <Callout tone="info" title="An expression that cannot be parsed is shown, not swallowed">
            <MathInline tex="\frac{a}" label="deliberately malformed" />
          </Callout>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader plain eyebrow="Inputs" title="Fields and thresholds" />
        <PanelBody className="ds-grid-2">
          <Field label="Pipeline name" hint="Used as the session name.">
            {({ id }) => <Input id={id} placeholder="e.g. SMR-SBY Gas Line" />}
          </Field>
          <Field label="Outer diameter">
            {({ id }) => (
              <Select id={id} defaultValue="10">
                <option value="10">10 inch</option>
                <option value="12">12 inch</option>
                <option value="24">24 inch</option>
              </Select>
            )}
          </Field>
          <Field label="Invalid example" error="Enter a positive wall thickness.">
            {({ id }) => <Input id={id} invalid defaultValue="-2" />}
          </Field>
          <SliderField
            label="Slippage tolerance"
            value={slider}
            display={`${slider}%`}
            min={0.1}
            max={10}
            step={0.1}
            onChange={setSlider}
            hint="Joints beyond this deviation enter the review queue."
          />
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader plain eyebrow="Sectioning" title="Range brush" subtitle="Drag across the rail; both ends snap to locked GWs." />
        <PanelBody>
          <SectionRangeBrush
            lockedGws={MOCK_GWS}
            sections={[
              { id: 's1', name: 'River crossing', policy: 'MATCH', startGwKey: 'k4', endGwKey: 'k9' },
              { id: 's2', name: 'Road', policy: 'REVIEW', startGwKey: 'k34', endGwKey: 'k41' },
            ]}
            markers={[
              { id: 'b1', distM: 2400, kind: 'bend', label: 'Bend' },
              { id: 'v1', distM: 6200, kind: 'valve', label: 'Valve' },
              { id: 't1', distM: 9800, kind: 'tee', label: 'Tee' },
            ]}
            selection={range}
            onSelect={(startIndex, endIndex) => setRange({ startIndex, endIndex })}
          />
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader plain eyebrow="Tables" title="Dense data grid" />
        <PanelBody flush>
          <div className="ds-table-wrap">
            <table className="ds-table">
              <thead>
                <tr>
                  <th>NEW weld</th>
                  <th className="ds-table__num">NEW (m)</th>
                  <th>OLD weld</th>
                  <th className="ds-table__num">Offset (m)</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {MOCK_GWS.slice(0, 6).map((gw, index) => (
                  <tr key={gw.key} className={index === 2 ? 'is-selected' : index === 4 ? 'is-danger' : undefined}>
                    <th scope="row">{gw.newId}</th>
                    <td className="ds-table__num">{gw.newDistance.toFixed(3)}</td>
                    <td>{gw.oldId}</td>
                    <td className="ds-table__num">{(gw.newDistance - gw.oldDistance).toFixed(3)}</td>
                    <td>{index === 4 ? <Badge tone="danger">Missing</Badge> : <Badge tone="success">Matched</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader plain eyebrow="Corrosion" title="Wall loss distribution" subtitle="Severity-banded, with the 80 %WT B31G domain limit." />
        <PanelBody><DepthHistogram features={MOCK_FEATURES} /></PanelBody>
      </Panel>

      <div className="ds-grid-2">
        <Panel>
          <PanelHeader plain eyebrow="Corrosion" title="Orientation by clock position" />
          <PanelBody><ClockRose features={MOCK_FEATURES} /></PanelBody>
        </Panel>
        <Panel>
          <PanelHeader plain eyebrow="Corrosion" title="Depth against length" />
          <PanelBody>
            <DepthLengthEnvelope
              features={MOCK_FEATURES}
              geometry={{ outerDiameterMm: 273, smysMpa: 359, designFactor: 0.72, operatingPressureMpa: 8.3 }}
            />
          </PanelBody>
        </Panel>
      </div>

      <Panel>
        <PanelHeader plain eyebrow="Corrosion" title="Density along the line" />
        <PanelBody><KpDensity features={MOCK_FEATURES} /></PanelBody>
      </Panel>

      <div className="ds-grid-2">
        <Panel>
          <PanelHeader plain eyebrow="Corrosion" title="Severity by section" />
          <PanelBody><SegmentSeverity features={MOCK_FEATURES} /></PanelBody>
        </Panel>
        <Panel>
          <PanelHeader plain eyebrow="Corrosion" title="Remaining life" />
          <PanelBody><RemainingLife features={MOCK_FEATURES} limit={8} /></PanelBody>
        </Panel>
      </div>

      <Panel>
        <PanelHeader plain eyebrow="Corrosion" title="Ranked review queue" />
        <PanelBody><ReviewQueue features={MOCK_FEATURES} pageSize={8} /></PanelBody>
      </Panel>

      <Panel>
        <PanelHeader plain eyebrow="Navigation" title="Step action bar" />
        <PanelBody>
          <ActionBar
            back={<Button variant="ghost">Back</Button>}
            center={<Button variant="secondary">Share view</Button>}
            next={<Button>Save &amp; continue</Button>}
            help="Confirm the acknowledgement to continue."
          />
        </PanelBody>
      </Panel>
    </div>
  );
}
