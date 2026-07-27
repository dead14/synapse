type ImportError = {
  code?: unknown;
  message?: unknown;
};

export function formatIngestionImportError(error: unknown): string {
  const candidate = error as ImportError | null;
  const code = typeof candidate?.code === 'string' ? candidate.code : undefined;
  const message = typeof candidate?.message === 'string' ? candidate.message : '';

  if (code === 'INGESTION_QUEUE_UNAVAILABLE') {
    return 'Import service is temporarily unavailable. Please retry shortly.';
  }

  if (code === 'INGESTION_PREPARATION_FAILED') {
    return 'Import service could not prepare this file. Please retry shortly. If it persists, contact an administrator.';
  }

  if (code === 'PARSER_DICTIONARY_UNAVAILABLE' || code === 'ORGANIZATION_LIMIT_REACHED') {
    return message || 'ILI import is not available for this workspace.';
  }

  const detail = message ? `\n\nDetail: ${message}` : '';
  return `Failed to import the ILI file. Check the format, year, vendor, and headers.${detail}`;
}
