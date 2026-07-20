export function facilityRbiCapability() {
  return {
    productBoundary: 'facility-rbi-add-on' as const,
    pipelineIntegrityDataModelShared: false,
    qualitativeScreening: {
      available: true,
      claim: 'Internal qualitative facility inspection-priority screening',
    },
    quantitativeApi581: {
      available: false,
      claim: null,
      missingValidation: [
        'Licensed calculation details',
        'Validated equipment and damage-mechanism input models',
        'Independent API 581 benchmark cases',
        'Documented calculation verification and approval',
      ],
    },
  };
}
