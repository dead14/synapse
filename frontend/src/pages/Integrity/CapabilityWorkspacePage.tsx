import { FiAlertTriangle, FiArrowRight, FiCheckCircle } from 'react-icons/fi';
import { Link, useParams } from 'react-router-dom';
import PageMeta from '../../components/common/PageMeta';

type Capability = {
  title: string; eyebrow: string; description: string;
  status: 'available' | 'foundation' | 'bounded';
  workflow: string[]; deliverables: string[]; boundary: string;
  primaryPath?: string; primaryLabel?: string;
};

const capabilities: Record<string, Capability> = {
  workbench: {
    title: 'Integrity Decision Workbench', eyebrow: 'Execution core',
    description: 'A traceable engineering path from canonical inspection evidence to verified field close-out.',
    status: 'foundation', workflow: ['Import', 'Validate', 'Align', 'Assess', 'Decide', 'Repair', 'Verify'],
    deliverables: ['Case ownership and deadlines', 'Engineering review gate', 'Approval history', 'Decision and evidence audit'],
    boundary: 'Workflow state is available as a validated domain contract. Persistent case APIs are the next delivery slice.',
    primaryPath: '/ffs', primaryLabel: 'Start FFS assessment',
  },
  repair: {
    title: 'Repair & Evidence Lifecycle', eyebrow: 'Execution core',
    description: 'Turn approved anomaly decisions into dig packages, field findings, repairs, and defensible close-out evidence.',
    status: 'foundation', workflow: ['Recommendation', 'Approval', 'Repair plan', 'Dig sheet', 'Excavation', 'NDE', 'Repair', 'Close-out'],
    deliverables: ['Anomaly action register', 'Due-date escalation', 'As-found vs ILI comparison', 'Immutable evidence status'],
    boundary: 'No work order is marked complete until required evidence is accepted by an authorized reviewer.',
  },
  compliance: {
    title: 'Indonesia Compliance Pack', eyebrow: 'Local assurance',
    description: 'Map integrity evidence to PLO, RLA, reverse-engineering, inspection, competency, and approval obligations.',
    status: 'foundation', workflow: ['Applicability', 'Requirement mapping', 'Evidence request', 'Review', 'Gap action', 'Dossier'],
    deliverables: ['Requirement-to-evidence traceability', 'PLO and RLA readiness', 'Approval register', 'Audit dossier status'],
    boundary: 'Regulatory mappings must cite the controlled requirement edition and receive local legal/engineering review.',
  },
  risk: {
    title: 'Transparent Pipeline Risk', eyebrow: 'Planning',
    description: 'Explain likelihood, consequence, threat interaction, uncertainty, and mitigation benefit without hiding the drivers.',
    status: 'available', workflow: ['Define segment', 'Score evidence', 'Assess threats', 'Compare mitigation', 'Prioritize', 'Approve plan'],
    deliverables: ['Risk-driver decomposition', 'Uncertainty bounds', 'What-if deltas', 'Conservative repair ordering'],
    boundary: 'Current engine is an auditable qualitative screening method and does not claim API 580/581 compliance.',
  },
  'direct-assessment': {
    title: 'Direct Assessment & CP', eyebrow: 'Unpiggable pipelines',
    description: 'Manage ECDA, ICDA, SCCDA, confirmatory DA, CP surveys, direct examination, and reassessment planning.',
    status: 'foundation', workflow: ['Pre-assessment', 'Indirect inspection', 'Prioritization', 'Direct examination', 'Post-assessment', 'Reassessment'],
    deliverables: ['CIPS/DCVG survey register', 'Excavation candidate ranking', 'Corrective actions', 'Reassessment interval basis'],
    boundary: 'Procedure selection and acceptance criteria remain controlled engineering decisions requiring qualified approval.',
  },
  'gis-field': {
    title: 'GIS/LRS & Mobile Field Thread', eyebrow: 'Authoritative location',
    description: 'Keep chainage, stationing, GPS, weld, anomaly, segment, job package, and field evidence connected.',
    status: 'foundation', workflow: ['Locate', 'Package', 'Download', 'Capture offline', 'Synchronize', 'Resolve conflict', 'Accept evidence'],
    deliverables: ['Authoritative location identity', 'Offline job package', 'Photo/GPS/NDE capture', 'Sync and conflict status'],
    boundary: 'GPS never silently replaces engineering chainage; every coordinate transformation retains provenance.',
  },
  rbi: {
    title: 'Facility RBI Add-on', eyebrow: 'Separate product boundary',
    description: 'An isolated facility integrity workspace, commercially and technically separate from pipeline integrity.',
    status: 'bounded', workflow: ['Asset hierarchy', 'Damage mechanisms', 'Qualitative screening', 'Inspection plan', 'Review'],
    deliverables: ['Separate module contract', 'Availability state', 'Method/version metadata', 'Validation evidence gate'],
    boundary: 'Quantitative API 581 calculations are unavailable until licensed calculation details and benchmark cases are supplied and validated.',
  },
  'advanced-threats': {
    title: 'Crack, Dent & Geohazard', eyebrow: 'Advanced threats',
    description: 'Controlled workspaces for crack management, dent/strain evidence, landslide, river crossing, and hydrotechnical threats.',
    status: 'bounded', workflow: ['Register threat', 'Validate evidence', 'Select validated method', 'Assess', 'Mitigate', 'Monitor'],
    deliverables: ['Threat register', 'Evidence completeness', 'Method adapter boundary', 'Qualified approval gate'],
    boundary: 'Workflow is available, but calculations remain unavailable until validated method adapters and benchmark cases are supplied.',
  },
  copilot: {
    title: 'Safe Engineering Copilot', eyebrow: 'Advisory assistance',
    description: 'Assist data QA, missing-evidence review, and report drafting while keeping engineering authority with people.',
    status: 'bounded', workflow: ['Read evidence', 'Flag gaps', 'Draft explanation', 'Human review', 'Approve or reject'],
    deliverables: ['QA suggestions', 'Missing-data prompts', 'Draft narrative', 'Full human decision authority'],
    boundary: 'Copilot output is advisory only. It cannot approve assessments, set operating limits, close repairs, or accept compliance evidence.',
  },
};

export default function CapabilityWorkspacePage() {
  const { capability = 'workbench' } = useParams();
  const config = capabilities[capability] ?? capabilities.workbench;
  return (
    <div className="syn-page">
      <PageMeta title={`${config.title} · Synapse`} description={config.description} />
      <div className="syn-shell">
        <header className="syn-page__header">
          <div><p className="syn-eyebrow">{config.eyebrow}</p><h1 className="syn-page__title">{config.title}</h1><p className="syn-page__subtitle">{config.description}</p></div>
          <span className={`syn-pill ${config.status === 'available' ? 'syn-pill--signal' : 'syn-pill--warning'}`}><span className="syn-dot" />{config.status === 'available' ? 'Engine available' : config.status === 'bounded' ? 'Bounded add-on' : 'Foundation active'}</span>
        </header>
        <section className="grid gap-4 xl:grid-cols-[1.35fr_.65fr]">
          <article className="syn-panel p-5">
            <p className="syn-kicker">Controlled workflow</p>
            <ol className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {config.workflow.map((step, index) => <li key={step} className="rounded-xl border border-gray-200 p-4 dark:border-gray-700"><span className="syn-pill syn-data">{String(index + 1).padStart(2, '0')}</span><strong className="mt-5 block text-sm">{step}</strong></li>)}
            </ol>
          </article>
          <aside className="syn-panel syn-panel--quiet p-5">
            <p className="syn-kicker">Engineering boundary</p>
            <div className="mt-4 flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"><FiAlertTriangle className="mt-0.5 shrink-0" aria-hidden="true" /><p className="m-0 text-sm leading-6">{config.boundary}</p></div>
            {config.primaryPath && <Link className="syn-action syn-action--ink mt-4 w-full" to={config.primaryPath}>{config.primaryLabel}<FiArrowRight aria-hidden="true" /></Link>}
          </aside>
        </section>
        <section className="syn-panel mt-4 p-5">
          <p className="syn-kicker">Commercial deliverables</p>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">{config.deliverables.map((item) => <div key={item} className="flex gap-3 rounded-xl bg-gray-50 p-4 dark:bg-gray-900"><FiCheckCircle className="mt-0.5 shrink-0 text-success-600" aria-hidden="true" /><span className="text-sm leading-5">{item}</span></div>)}</div>
        </section>
      </div>
    </div>
  );
}
