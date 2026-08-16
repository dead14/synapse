export type NavigationItem = {
  label: string;
  path: string;
  description: string;
};

export type NavigationGroup = {
  label: string;
  items: NavigationItem[];
  roles?: string[];
};

export const navigationGroups: NavigationGroup[] = [
  {
    label: 'Portfolio',
    items: [
      { label: 'Overview', path: '/', description: 'Decision readiness and measured portfolio health' },
    ],
  },
  {
    label: 'Data & alignment',
    items: [
      // One registry, not two. The ILI-runs page listed the same survey runs this
      // table already reaches through its sessions, so a run appeared twice with
      // two different sets of actions. Import now happens inside the alignment
      // wizard, which is where a run is actually used.
      { label: 'ILI alignment', path: '/alignment-history', description: 'Inspection runs, their alignment results, and FFS handoff' },
      { label: 'Activity log', path: '/activity-logs', description: 'What each user did, in order' },
    ],
  },
  {
    label: 'Assessment',
    items: [
      { label: 'FFS · B31G', path: '/ffs', description: 'Corrosion remaining-strength screening' },
      { label: 'Risk-based inspection', path: '/rbi', description: 'API 580 risk ranking and inspection planning from filed FFS assessments' },
    ],
  },
  {
    label: 'Execution',
    items: [
      { label: 'Decision workbench', path: '/integrity-workbench', description: 'Import through repair verification' },
      { label: 'Repair lifecycle', path: '/repair-evidence', description: 'Plans, digs, approvals, and close-out evidence' },
      { label: 'Indonesia compliance', path: '/compliance-indonesia', description: 'PLO, RLA, reverse engineering, and dossiers' },
      { label: 'Pipeline risk', path: '/pipeline-risk', description: 'Transparent drivers, uncertainty, and what-if' },
      { label: 'Direct assessment & CP', path: '/direct-assessment', description: 'ECDA, ICDA, SCCDA, CIPS, and DCVG' },
      { label: 'GIS & field', path: '/integrity/gis-field', description: 'Authoritative LRS and offline field packages' },
      { label: 'Facility RBI add-on', path: '/integrity/rbi', description: 'Separate bounded API 580/581 product' },
      { label: 'Advanced threats', path: '/integrity/advanced-threats', description: 'Crack, dent/strain, geohazard, and crossings' },
      { label: 'Engineering copilot', path: '/integrity/copilot', description: 'Advisory QA and report support with human approval' },
    ],
  },
  {
    label: 'Administration',
    roles: ['admin', 'super_admin'],
    items: [
      { label: 'Users', path: '/users', description: 'Organization members and access' },
      { label: 'Organizations', path: '/organizations', description: 'Tenant administration' },
      { label: 'Roles', path: '/roles', description: 'Permission boundaries' },
    ],
  },
];

export function navigationForRole(role: string | undefined): NavigationGroup[] {
  const groups = navigationGroups.filter((group) => !group.roles || (role ? group.roles.includes(role) : false));
  if (role !== 'super_admin') return groups;
  return [
    ...groups,
    {
      label: 'Master administration',
      roles: ['super_admin'],
      items: [
        { label: 'System control', path: '/master-admin', description: 'Organizations, limits, recovery, and audit evidence' },
      ],
    },
  ];
}
