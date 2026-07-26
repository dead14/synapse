import React, { useMemo, useEffect } from 'react';
import { MapContainer, TileLayer, Polyline, Tooltip, Marker, CircleMarker, useMapEvents, useMap } from 'react-leaflet';
import type { SectionDef } from './types';
import { sectionColor } from './sectionColors';
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

function MapBoundsUpdater({ bounds }: { bounds: [ [number, number], [number, number] ] | null }) {
  const map = useMap();
  useEffect(() => {
    if (bounds) {
      map.fitBounds(bounds, { padding: [20, 20], animate: true });
    }
  }, [bounds, map]);
  return null;
}

function MapClickHandler({ onMapClick }: { onMapClick: (e: any) => void }) {
  useMapEvents({
    click: (e) => onMapClick(e),
  });
  return null;
}

interface SectionMapProps {
  sections: SectionDef[];
  features?: any;
  selectedGWs?: any[];
  onGwClick?: (gw: any) => void;
  pickingMode?: 'start' | 'end' | 'route' | null;
  drawnRoute?: [number, number][];
  onMapClickCoords?: (lat: number, lng: number) => void;
}

export default function SectionMap({ 
  sections, 
  features, 
  selectedGWs, 
  onGwClick, 
  pickingMode = null, 
  drawnRoute = [], 
  onMapClickCoords
}: SectionMapProps) {
  // Find all sections that have coordinates
  const sectionsWithCoords = useMemo(() => {
    return sections.filter(s => 
      s.latStart !== undefined && s.lngStart !== undefined && 
      s.latEnd !== undefined && s.lngEnd !== undefined
    );
  }, [sections]);

  // Extract all points for the pipeline polyline
  const pipelinePoints = useMemo(() => {
    if (!features?.allFeatures) return [];
    return features.allFeatures
      .filter((f: any) => f.lat !== undefined && f.lng !== undefined && !isNaN(f.lat) && !isNaN(f.lng))
      .map((f: any) => [f.lat, f.lng] as [number, number]);
  }, [features]);

  // Calculate bounding box or default center
  const bounds = useMemo(() => {
    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
    let hasPoints = false;
    
    if (pipelinePoints.length > 0) {
      pipelinePoints.forEach((p: [number, number]) => {
        if (p[0] < minLat) minLat = p[0];
        if (p[0] > maxLat) maxLat = p[0];
        if (p[1] < minLng) minLng = p[1];
        if (p[1] > maxLng) maxLng = p[1];
      });
      hasPoints = true;
    } else if (sectionsWithCoords.length > 0) {
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
      hasPoints = true;
    } else if (drawnRoute.length > 0) {
      drawnRoute.forEach(p => {
        if (p[0] < minLat) minLat = p[0];
        if (p[0] > maxLat) maxLat = p[0];
        if (p[1] < minLng) minLng = p[1];
        if (p[1] > maxLng) maxLng = p[1];
      });
      hasPoints = true;
    }
    
    if (!hasPoints) return null;
    
    // Add small padding to bounds
    const latPad = (maxLat - minLat) * 0.1 || 0.01;
    const lngPad = (maxLng - minLng) * 0.1 || 0.01;
    
    return [
      [minLat - latPad, minLng - lngPad] as [number, number],
      [maxLat + latPad, maxLng + lngPad] as [number, number]
    ];
  }, [sectionsWithCoords, pipelinePoints, drawnRoute]);

  const defaultCenter: [number, number] = [-2.5489, 118.0149]; // Center of Indonesia

  const handleMapClick = (e: any) => {
    const { lat, lng } = e.latlng;
    
    if (pickingMode !== null && onMapClickCoords) {
      onMapClickCoords(lat, lng);
      return;
    }

    if (!onGwClick || !features?.gws) return;
    
    let minDistance = Infinity;
    let nearest = null;
    for (const gw of features.gws) {
      if (gw.lat === undefined || gw.lng === undefined || isNaN(gw.lat) || isNaN(gw.lng)) continue;
      const d = Math.pow(gw.lat - lat, 2) + Math.pow(gw.lng - lng, 2);
      if (d < minDistance) {
        minDistance = d;
        nearest = gw;
      }
    }
    
    if (nearest) {
      onGwClick(nearest);
    }
  };

  const isDrawingRoute = pickingMode !== null;

  return (
    <div className="w-full relative z-0" style={{ height: '550px', cursor: isDrawingRoute ? 'crosshair' : 'default' }}>
      <MapContainer 
        bounds={bounds || undefined}
        center={!bounds ? defaultCenter : undefined} 
        zoom={!bounds ? 5 : undefined} 
        scrollWheelZoom={true} 
        style={{ height: '100%', width: '100%', background: '#e2e8f0' }}
      >
        <TileLayer
          attribution='&copy; Google Maps'
          url="https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}"
          maxZoom={20}
        />
        
        <MapBoundsUpdater bounds={bounds as any} />
        <MapClickHandler onMapClick={handleMapClick} />
        
        {/* Draw the user's custom drawn route if it exists */}
        {drawnRoute.length > 0 && (
          <Polyline 
            positions={drawnRoute} 
            color="#f97316" 
            weight={isDrawingRoute ? 4 : 6}
            opacity={1}
            dashArray={isDrawingRoute ? "10, 10" : undefined}
            eventHandlers={{ click: handleMapClick }}
          />
        )}

        {/* Draw points for the custom route */}
        {drawnRoute.length > 0 && drawnRoute.map((pt, i) => (
          <React.Fragment key={`drawn-pt-${i}`}>
            <CircleMarker
              center={pt}
              radius={6}
              pathOptions={{ fillColor: i === 0 ? '#10b981' : '#ef4444', color: '#ffffff', weight: 2, fillOpacity: 1 }}
            >
            </CircleMarker>
            <Marker 
              position={pt} 
              icon={L.divIcon({
                className: 'custom-drawn-label bg-transparent border-0',
                html: `<div style="background: rgba(255,255,255,0.9); border: 2px solid ${i === 0 ? '#10b981' : '#ef4444'}; padding: 3px 8px; border-radius: 6px; font-weight: 800; font-size: 11px; color: #1f2937; white-space: nowrap; box-shadow: 0 2px 4px rgba(0,0,0,0.1); transform: translate(-50%, -150%);">${i === 0 ? 'START (WELD PERTAMA)' : i === drawnRoute.length - 1 ? 'END (WELD TERAKHIR)' : `Titik ${i+1}`}</div>`,
                iconAnchor: [0, 0]
              })} 
            />
          </React.Fragment>
        ))}
        
        {/* Draw full pipeline route (only if not drawing, to avoid duplicate lines if interpolated) */}
        {!isDrawingRoute && drawnRoute.length === 0 && pipelinePoints.length > 0 && (
          <Polyline 
            positions={pipelinePoints} 
            color="#cbd5e1" 
            weight={6}
            opacity={0.8}
            dashArray="10, 10"
            eventHandlers={{ click: handleMapClick }}
          />
        )}
        
        {/* Draw sections */}
        {sectionsWithCoords.map(sec => {
          const positions: [number, number][] = [
            [sec.latStart!, sec.lngStart!],
            [sec.latEnd!, sec.lngEnd!]
          ];
          
          const midLat = (sec.latStart! + sec.latEnd!) / 2;
          const midLng = (sec.lngStart! + sec.lngEnd!) / 2;
          const color = sectionColor(sec.type);
          const labelIcon = L.divIcon({
            className: 'custom-section-label bg-transparent border-0',
            html: `<div style="background: rgba(255,255,255,0.9); border: 2px solid ${color}; padding: 2px 8px; border-radius: 6px; font-weight: 800; font-size: 11px; color: #1f2937; white-space: nowrap; box-shadow: 0 2px 4px rgba(0,0,0,0.1); transform: translate(-50%, -50%);">${sec.name}</div>`,
            iconAnchor: [0, 0]
          });
          
          return (
            <React.Fragment key={`map-sec-${sec.id}`}>
              <Polyline 
                positions={positions} 
                color={color} 
                weight={8}
                opacity={0.8}
              />
              
              <Marker position={[midLat, midLng]} icon={labelIcon} />
              
              <CircleMarker center={positions[0]} radius={4} pathOptions={{ color: '#1f2937', fillColor: '#fff', weight: 2, fillOpacity: 1 }}>
                <Tooltip>START GW: {sec.startGw}</Tooltip>
              </CircleMarker>
              <CircleMarker center={positions[1]} radius={4} pathOptions={{ color: '#1f2937', fillColor: '#fff', weight: 2, fillOpacity: 1 }}>
                <Tooltip>END GW: {sec.endGw}</Tooltip>
              </CircleMarker>
            </React.Fragment>
          );
        })}

        {/* Draw clickable GWs */}
        {!isDrawingRoute && features?.gws && features.gws.map((gw: any) => {
          if (gw.lat === undefined || gw.lng === undefined || isNaN(gw.lat) || isNaN(gw.lng)) return null;
          
          const isSelected = selectedGWs?.some(s => s.id === gw.id);
          const radius = isSelected ? 8 : 2;
          const weight = isSelected ? 3 : 0;
          const fillColor = isSelected ? '#ef4444' : '#14b8a6';
          const strokeColor = isSelected ? '#ffffff' : 'transparent';
          
          return (
            <CircleMarker
              key={`map-gw-${gw.id}`}
              center={[gw.lat, gw.lng]}
              radius={radius}
              pathOptions={{ fillColor: fillColor, color: strokeColor, weight: weight, fillOpacity: 0.8 }}
              eventHandlers={{
                click: (e) => {
                  L.DomEvent.stopPropagation(e);
                  onGwClick?.(gw);
                }
              }}
            >
              <Tooltip>
                <div className="font-sans text-xs">
                  <strong>GW: {gw.id}</strong><br/>
                  Dist: {gw.dist.toFixed(2)}m
                </div>
              </Tooltip>
            </CircleMarker>
          );
        })}
      </MapContainer>
      
      {/* Floating Instruction Button */}
      <div className="absolute top-4 right-4 z-[1000] flex flex-col gap-2 items-end pointer-events-none">
        <div className="bg-white px-4 py-2 rounded-lg shadow-lg border border-gray-200">
          <span className="text-sm font-bold text-gray-700 flex items-center gap-2">
            {pickingMode === 'start' ? (
               <><div className="w-3 h-3 rounded-full bg-blue-500 animate-pulse"></div>Klik Peta Untuk Menentukan Titik Awal</>
            ) : pickingMode === 'end' ? (
               <><div className="w-3 h-3 rounded-full bg-blue-500 animate-pulse"></div>Klik Peta Untuk Menentukan Titik Akhir</>
            ) : pickingMode === 'route' ? (
               <><div className="w-3 h-3 rounded-full bg-orange-500 animate-pulse"></div>Mode Gambar Rute Bebas ({drawnRoute.length} titik)</>
            ) : (
               <><div className="w-3 h-3 rounded-full bg-red-500 animate-pulse"></div>Pilih GW Untuk Membuat Section</>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
