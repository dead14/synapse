import { FiMapPin, FiX } from 'react-icons/fi';
import { isBendType } from './bendGeometry';
import { getGwPositionDetails } from './gwPosition';
import type { SpatialFeature } from './types';

interface Props {
  feature: SpatialFeature;
  onDismiss: () => void;
}

export default function GwPositionCard({ feature, onDismiss }: Props) {
  const details = getGwPositionDetails(feature);
  const normalizedType = feature.type.toLowerCase();
  const isWeld = /weld|girth|seam|\bgw\b/.test(normalizedType);
  const isBend = isBendType(normalizedType);
  const featureKind = isBend ? 'BEND' : isWeld ? 'GW' : 'FEATURE';
  const status = isWeld
    ? feature.status === 'MATCHED' ? 'Paired' : feature.runRole === 'MASTER' ? 'No OLD pair' : 'No NEW pair'
    : feature.type;

  return (
    <aside className="sectioning-light-position-card" aria-label={`Selected ${featureKind.toLowerCase()} position details`}>
      <div>
        <p><FiMapPin /> SELECTED {featureKind} POSITION</p>
        <h3>{feature.id}</h3>
        <span>{feature.runRole === 'MASTER' ? 'NEW master' : `OLD ${feature.runYear || ''}`} · {status}</span>
      </div>
      <dl>
        {details.primaryOriginalLd && (
          <div>
            <dt>Source LD (raw data)</dt>
            <dd>{details.primaryOriginalLd}</dd>
          </div>
        )}
        <div>
          <dt>{details.primaryOriginalLd ? `Plot position ${feature.runRole === 'MASTER' ? 'NEW' : 'OLD'}` : details.primaryLabel}</dt>
          <dd>{details.primaryDistance}</dd>
        </div>
        {details.pairedDistance && <div><dt>{details.pairedLabel}{details.pairedId ? ` · ${details.pairedId}` : ''}</dt><dd>{details.pairedDistance}</dd></div>}
      </dl>
      <button type="button" onClick={onDismiss} aria-label={`Close ${featureKind.toLowerCase()} position details`}><FiX /></button>
    </aside>
  );
}
