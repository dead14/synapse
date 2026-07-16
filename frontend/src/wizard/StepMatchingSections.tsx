import { useMemo, useState } from 'react';
import { FiChevronLeft, FiChevronRight, FiPlus, FiTrash2 } from 'react-icons/fi';
import {
  type MatchingSection,
  type SectionTolerances,
  normalizeLockedGws,
  resolveSectionDistances,
  validateSectionOrder,
} from './matchingSections';

interface Props {
  config: any;
  onBack: () => void;
  onNext: (data: { matchingSections: MatchingSection[] }) => void;
}

const defaultTolerances = (config: any): SectionTolerances => ({
  clock_tolerance: Number(config?.ToleranceConfig?.clock_tolerance ?? 15),
  us_gw_distance_tolerance: Number(config?.ToleranceConfig?.us_gw_distance_tolerance ?? 0.2),
  ds_gw_distance_tolerance: Number(config?.ToleranceConfig?.ds_gw_distance_tolerance ?? 0.2),
  depth_tolerance: Number(config?.ToleranceConfig?.depth_tolerance ?? 10),
  length_tolerance: Number(config?.ToleranceConfig?.length_tolerance ?? 50),
});

export default function StepMatchingSections({ config, onBack, onNext }: Props) {
  const lockedGws = useMemo(() => normalizeLockedGws(config?.gwMatchesFinal || []), [config?.gwMatchesFinal]);
  const initialSections = useMemo<MatchingSection[]>(() => {
    if (Array.isArray(config?.matchingSections) && config.matchingSections.length > 0) {
      return config.matchingSections;
    }
    if (lockedGws.length < 2) return [];
    return [{
      id: 'section-main',
      name: 'Main Pipeline',
      policy: 'MATCH',
      startGwKey: lockedGws[0].key,
      endGwKey: lockedGws[lockedGws.length - 1].key,
    }];
  }, [config?.matchingSections, lockedGws]);
  const [sections, setSections] = useState<MatchingSection[]>(initialSections);
  const validationError = validateSectionOrder(sections, lockedGws);

  const updateSection = (index: number, patch: Partial<MatchingSection>) => {
    setSections((current) => current.map((section, itemIndex) => (
      itemIndex === index ? { ...section, ...patch } : section
    )));
  };

  const addSection = () => {
    if (lockedGws.length < 2) return;
    setSections((current) => {
      const indexes = new Map(lockedGws.map((gw, index) => [gw.key, index]));
      if (current.length === 1
        && indexes.get(current[0].startGwKey) === 0
        && indexes.get(current[0].endGwKey) === lockedGws.length - 1
        && lockedGws.length >= 3) {
        const splitIndex = Math.floor((lockedGws.length - 1) / 2);
        return [
          { ...current[0], endGwKey: lockedGws[splitIndex].key },
          {
            id: `section-${Date.now()}`,
            name: 'Section 2',
            policy: 'MATCH',
            startGwKey: lockedGws[splitIndex].key,
            endGwKey: lockedGws[lockedGws.length - 1].key,
          },
        ];
      }

      const covered = new Array(Math.max(lockedGws.length - 1, 0)).fill(false);
      for (const section of current) {
        const start = indexes.get(section.startGwKey);
        const end = indexes.get(section.endGwKey);
        if (start === undefined || end === undefined) continue;
        for (let segment = start; segment < end; segment += 1) covered[segment] = true;
      }
      const availableSegment = covered.findIndex((isCovered) => !isCovered);
      if (availableSegment < 0) return current;
      return [...current, {
        id: `section-${Date.now()}`,
        name: `Section ${current.length + 1}`,
        policy: 'MATCH',
        startGwKey: lockedGws[availableSegment].key,
        endGwKey: lockedGws[availableSegment + 1].key,
      }];
    });
  };

  const proceed = () => {
    if (validationError) return;
    onNext({ matchingSections: sections.map((section) => resolveSectionDistances(section, lockedGws)) });
  };

  if (lockedGws.length < 2) {
    return (
      <div className="alignment-surface rounded-2xl border border-red-200 bg-white p-6 sm:p-8">
        <h2 className="text-xl font-bold text-gray-800">NEW Reference Sectioning</h2>
        <p role="alert" className="mt-3 text-sm text-red-700">
          Minimal dua pasangan GW locked diperlukan untuk membuat section. Kembali dan periksa GW Alignment.
        </p>
        <button onClick={onBack} className="mt-6 rounded-xl border border-gray-200 px-5 py-2.5 font-medium text-gray-700">
          Kembali ke GW Matching
        </button>
      </div>
    );
  }

  return (
    <div className="alignment-surface rounded-2xl border border-gray-100 bg-white p-6 shadow-sm sm:p-8">
      <div className="flex flex-col gap-3 border-b border-gray-100 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-brand-600">Current run reference</p>
          <h2 className="mt-1 text-xl font-bold text-gray-800">Sectioning berdasarkan GW NEW</h2>
          <p className="mt-1 text-sm text-gray-500">Anomaly tidak boleh match keluar section atau meloncati urutan pipeline.</p>
        </div>
        <button onClick={addSection} className="inline-flex items-center justify-center gap-2 rounded-xl border border-brand-200 px-4 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-50">
          <FiPlus /> Tambah Section
        </button>
      </div>

      <div className="mt-6 space-y-4">
        {sections.map((section, index) => (
          <section key={section.id} className="rounded-xl border border-gray-200 bg-gray-50/60 p-4" aria-label={section.name}>
            <div className="grid gap-4 lg:grid-cols-[1fr_1fr_1fr_140px_auto]">
              <label className="text-xs font-semibold text-gray-600">Nama
                <input value={section.name} onChange={(event) => updateSection(index, { name: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm" />
              </label>
              <label className="text-xs font-semibold text-gray-600">Start GW (NEW)
                <select value={section.startGwKey} onChange={(event) => updateSection(index, { startGwKey: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
                  {lockedGws.map((gw) => <option key={gw.key} value={gw.key}>{gw.newDistance.toFixed(3)} m · {gw.newId}</option>)}
                </select>
              </label>
              <label className="text-xs font-semibold text-gray-600">End GW (NEW)
                <select value={section.endGwKey} onChange={(event) => updateSection(index, { endGwKey: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
                  {lockedGws.map((gw) => <option key={gw.key} value={gw.key}>{gw.newDistance.toFixed(3)} m · {gw.newId}</option>)}
                </select>
              </label>
              <label className="text-xs font-semibold text-gray-600">Policy
                <select value={section.policy} onChange={(event) => updateSection(index, { policy: event.target.value as MatchingSection['policy'] })} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
                  <option value="MATCH">Match</option><option value="REVIEW">Review</option><option value="BYPASS">Bypass</option>
                </select>
              </label>
              <button aria-label={`Hapus ${section.name}`} onClick={() => setSections((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="self-end rounded-lg p-2.5 text-red-600 hover:bg-red-50"><FiTrash2 /></button>
            </div>

            <label className="mt-4 flex items-center gap-2 text-xs font-semibold text-gray-600">
              <input type="checkbox" checked={Boolean(section.tolerances)} onChange={(event) => updateSection(index, { tolerances: event.target.checked ? defaultTolerances(config) : undefined })} />
              Gunakan tolerance khusus section
            </label>
            {section.tolerances && (
              <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-5">
                {Object.entries(section.tolerances).map(([key, value]) => (
                  <label key={key} className="text-[11px] font-medium text-gray-500">{key.replaceAll('_', ' ')}
                    <input type="number" min="0" step="0.05" value={value} onChange={(event) => updateSection(index, { tolerances: { ...section.tolerances!, [key]: Number(event.target.value) } })} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm" />
                  </label>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>

      {validationError && <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{validationError}</p>}
      <div className="mt-6 flex justify-between border-t border-gray-100 pt-5">
        <button onClick={onBack} className="flex items-center gap-2 rounded-xl px-5 py-3 font-medium text-gray-600 hover:bg-gray-50"><FiChevronLeft /> GW Matching</button>
        <button disabled={Boolean(validationError)} onClick={proceed} className="flex items-center gap-2 rounded-xl bg-gray-900 px-6 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">Simpan Section <FiChevronRight /></button>
      </div>
    </div>
  );
}
