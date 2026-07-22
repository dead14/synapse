import { FiMapPin, FiX } from 'react-icons/fi';
import { getGwPositionDetails } from './gwPosition';
import type { SpatialFeature } from './types';

interface Props {
  feature: SpatialFeature;
  onDismiss: () => void;
}

export default function GwPositionCard({ feature, onDismiss }: Props) {
  const details = getGwPositionDetails(feature);
  const status = feature.status === 'MATCHED' ? 'Paired' : feature.runRole === 'MASTER' ? 'Tidak ada pasangan OLD' : 'Tidak ada pasangan NEW';

  return (
    <aside className="sectioning-light-position-card" aria-label="Detail posisi weld yang dipilih">
      <div>
        <p><FiMapPin /> POSISI GW TERPILIH</p>
        <h3>{feature.id}</h3>
        <span>{feature.runRole === 'MASTER' ? 'NEW master' : `OLD ${feature.runYear || ''}`} · {status}</span>
      </div>
      <dl>
        <div><dt>{details.primaryLabel}</dt><dd>{details.primaryDistance}</dd></div>
        {details.pairedDistance && <div><dt>{details.pairedLabel}{details.pairedId ? ` · ${details.pairedId}` : ''}</dt><dd>{details.pairedDistance}</dd></div>}
      </dl>
      <button type="button" onClick={onDismiss} aria-label="Tutup detail posisi weld"><FiX /></button>
    </aside>
  );
}
