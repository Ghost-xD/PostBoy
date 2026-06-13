import { parseHarFromFileReadResult } from '$lib/utils/harImporter';

export type HarHistoryWriter = (
  requestData: Record<string, unknown>,
  responseData: Record<string, unknown>
) => Promise<unknown>;

export type HarImportSuccess = {
  ok: true;
  imported: number;
  skipped: number;
  warningCount: number;
};

export type HarImportFailure = {
  ok: false;
  message: string;
};

export type HarImportResult = HarImportSuccess | HarImportFailure;

/**
 * End-to-end HAR import: unwrap read_file result, parse entries, persist each to history.
 * This is the path HistorySidebar uses — tests must cover read_file's `{ data }` wrapper.
 */
export async function importHarEntriesFromReadResult(
  readResult: unknown,
  addHistory: HarHistoryWriter
): Promise<HarImportResult> {
  const { entries, errors, skipped } = parseHarFromFileReadResult(readResult);

  if (entries.length === 0) {
    return {
      ok: false,
      message: errors[0] ?? 'No HAR entries found',
    };
  }

  for (const entry of entries) {
    await addHistory(entry.requestData, entry.responseData);
  }

  return {
    ok: true,
    imported: entries.length,
    skipped,
    warningCount: errors.length,
  };
}
