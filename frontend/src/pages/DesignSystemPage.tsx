import { useState } from 'react';
import { FiAlertTriangle, FiCheckCircle, FiDownload, FiInfo, FiPlus, FiTarget, FiMap } from 'react-icons/fi';

import {
  ActionBar,
  Badge,
  Button,
  Callout,
  Field,
  Input,
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
import type { LockedGwPair } from '../wizard/matchingSections';

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
            <Stat lead label="Total features" value="4,835" hint="Master run" />
            <Stat label="GW anchors" value="1,146" hint="Reference points" />
            <Stat label="Matched" value="92.3%" tone="success" />
            <Stat label="Review queue" value="24" tone="warning" />
            <Stat label="Missing" value="66" tone="danger" />
          </StatGrid>
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
