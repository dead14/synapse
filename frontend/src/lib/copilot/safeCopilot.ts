export function createCopilotSuggestion(input: { caseId: string; prompt: string; findings: string[] }) {
  if (!input.caseId || !input.prompt.trim()) throw new Error('caseId and prompt are required');
  return {
    ...input,
    authority: 'advisory-only' as const,
    canApprove: false,
    canChangeOperatingLimit: false,
    requiresHumanReview: true,
    generatedAt: new Date().toISOString(),
  };
}
