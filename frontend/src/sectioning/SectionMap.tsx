import React, { useMemo } from 'react';
import { MapContainer, TileLayer, Polyline, Tooltip, Marker, Popup } from 'react-leaflet';
import { SectionDef } from './IliSectioningPage';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// Fix Leaflet's default icon issue with React
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

let DefaultIcon = L.icon({
    iconUrl: icon,
    shadowUrl: iconShadow,
    iconAnchor: [12, 41],
});
L.Marker.prototype.options.icon = DefaultIcon;

interface SectionMapProps {
  sections: SectionDef[];
}

export default function SectionMap({ sections }: SectionMapProps) {
  // Find all sections that have coordinates
  const sectionsWithCoords = useMemo(() => {
    return sections.filter(s => 
      s.latStart !== undefined && s.lngStart !== undefined && 
      s.latEnd !== undefined && s.lngEnd !== undefined
    );
  }, [sections]);

  // Calculate bounding box or default center
  const bounds = useMemo(() => {
    if (sectionsWithCoords.length === 0) return null;
    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
    
    sectionsWithCoords.forEach(s => {
      if (s.latStart! < minLat) minLat = s.latStart!;
      if (s.latEnd! < minLat) minLat = s.latEnd!;
      if (s.latStart! > maxLat) maxLat = s.latStart!;
      if (s.latEnd! > maxLat) maxLat = s.latEnd!;
      
      if (s.lngStart! < minLng) minLng = s.lngStart!;
      if (s.lngEnd! < minLng) minLng = s.lngEnd!;
      if (s.lngStart! > maxLng) maxLng = s.lngStart!;
      if (s.lngEnd! > maxLng) maxLng = s.lngEnd!;
    });
    
    return [
      [minLat, minLng] as [number, number],
      [maxLat, maxLng] as [number, number]
    ];
  }, [sectionsWithCoords]);

  const defaultCenter: [number, number] = [-2.5489, 118.0149]; // Center of Indonesia

  const getSectionColor = (type: string) => {
    switch (type) {
      case 'RL': return '#2dd4bf';
      case 'AL': return '#60a5fa';
      case 'RIS': return '#ef4444';
      case 'ROC': return '#fb923c';
      case 'BUR': return '#a3e635';
      case 'CAS': return '#94a3b8';
      default: return '#c084fc';
    }
  };

  return (
    <div className="w-full h-full relative z-0">
      <MapContainer 
        bounds={bounds || undefined}
        center={!bounds ? defaultCenter : undefined} 
        zoom={!bounds ? 5 : undefined} 
        scrollWheelZoom={true} 
        style={{ height: '100%', width: '100%', background: '#0f172a' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        />
        
        {sectionsWithCoords.map(sec => {
          const positions: [number, number][] = [
            [sec.latStart!, sec.lngStart!],
            [sec.latEnd!, sec.lngEnd!]
          ];
          
          return (
            <React.Fragment key={`map-sec-${sec.id}`}>
              <Polyline 
                positions={positions} 
                color={getSectionColor(sec.type)} 
                weight={8}
                opacity={0.8}
              >
                <Tooltip sticky>
                  <div className="font-sans font-bold text-gray-800">
                    {sec.name} ({sec.type})<br/>
                    Length: {sec.length.toFixed(2)}m
                  </div>
                </Tooltip>
              </Polyline>
              
              <Marker position={positions[0]}>
                <Popup>START GW: {sec.startGw}</Popup>
              </Marker>
              <Marker position={positions[1]}>
                <Popup>END GW: {sec.endGw}</Popup>
              </Marker>
            </React.Fragment>
          );
        })}
      </MapContainer>
      
      {sectionsWithCoords.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 pointer-events-none z-[1000]">
          <div className="bg-[#1e293b] px-6 py-4 rounded-xl border border-yellow-500/50 text-yellow-400 font-sans shadow-2xl flex flex-col items-center gap-2">
            <span className="font-bold">Peta Kosong</span>
            <span className="text-sm">Belum ada section yang memiliki koordinat Lat/Long.</span>
          </div>
        </div>
      )}
    </div>
  );
}
