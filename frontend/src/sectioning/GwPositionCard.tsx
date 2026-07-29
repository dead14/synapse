import { FiMapPin, FiX } from 'react-icons/fi';
import { getGwPositionDetails } from './gwPosition';
import type { SpatialFeature } from './types';

interface Props {
  feature: SpatialFeature;
  onDismiss: () => void;
}

export default function GwPositionCard({ feature, onDismiss }: Props) {
  const details = getGwPositionDetails(feature);
  const status = feature.status === 'MATCHED' ? 'Paired' : feature.runRole === 'MASTER' ? 'No OLD pair' : 'No NEW pair';

  return (
    <aside className="sectioning-light-position-card" aria-label="Selected weld position details">
      <div>
        <p><FiMapPin /> SELECTED GW POSITION</p>
        <h3>{feature.id}</h3>
        <span>{feature.runRole === 'MASTER' ? 'NEW master' : `OLD ${feature.runYear || ''}`} · {status}</span>
      </div>
      <dl>
        <div>
          <dt>{details.primaryLabel}</dt>
          <dd>
            {details.primaryDistance}
            {details.primaryOriginalLd && <span style={{ opacity: 0.7, fontSize: '0.85em', marginLeft: '0.5rem', fontWeight: 500 }}>(Orig LD: {details.primaryOriginalLd})</span>}
          </dd>
        </div>
        {details.pairedDistance && <div><dt>{details.pairedLabel}{details.pairedId ? ` · ${details.pairedId}` : ''}</dt><dd>{details.pairedDistance}</dd></div>}
      </dl>
      <button type="button" onClick={onDismiss} aria-label="Close weld position details"><FiX /></button>
    </aside>
  );
}
