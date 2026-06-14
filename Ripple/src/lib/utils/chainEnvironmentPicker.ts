import { get } from 'svelte/store';
import * as modalManager from '$lib/utils/modalManager.svelte';
import { environments, activeEnvironmentId, setActiveEnvironment } from '$lib/stores/environmentStore';

/** `null` = no environment; `undefined` = user cancelled. */
export type ChainEnvironmentPick = number | null;

export async function pickChainRunEnvironment(chainName: string): Promise<ChainEnvironmentPick | undefined> {
  await environments.loadAll();
  const envList = environments.getAll();
  const activeId = get(activeEnvironmentId);

  const options = [
    { value: '', label: 'No Environment (collection variables only)' },
    ...envList.map((e) => ({ value: String(e.id), label: e.name })),
  ];

  const result = await modalManager.showForm(
    'Run Chain',
    `Choose an environment for "${chainName}". Values like {{baseUrl}}, {{apiKey}}, and {{apiToken}} are resolved from the selected environment.`,
    [
      {
        id: 'environmentId',
        label: 'Environment',
        type: 'select',
        value: activeId != null ? String(activeId) : '',
        options,
      },
    ],
    { confirmLabel: 'Run', cancelLabel: 'Cancel', type: 'question' }
  );

  if (!result) return undefined;

  const raw = result.environmentId?.trim() ?? '';
  if (!raw) return null;

  const id = Number(raw);
  return Number.isFinite(id) ? id : null;
}

export async function applyChainRunEnvironment(envId: ChainEnvironmentPick): Promise<string> {
  await setActiveEnvironment(envId);
  if (envId == null) return 'No Environment';
  return environments.getById(envId)?.name ?? 'Unknown';
}
