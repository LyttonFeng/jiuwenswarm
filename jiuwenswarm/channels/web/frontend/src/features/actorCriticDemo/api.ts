import type { RewardRun, RewardRuntimeInfo, RewardTaskPreset, PackMode } from './types';

const API_BASE = (
  import.meta.env.VITE_SWARM_REWARD_API_BASE || 'http://127.0.0.1:8765'
).replace(/\/$/, '');

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(body.error || `Swarm Reward service returned ${response.status}`);
  }
  return body;
}

export async function checkRewardService(): Promise<void> {
  await request<{ ok: true }>('/health');
}

export async function loadRewardTasks(): Promise<{
  tasks: RewardTaskPreset[];
  runtime: RewardRuntimeInfo;
}> {
  return request('/api/tasks');
}

export async function loadRecentRuns(): Promise<RewardRun[]> {
  const response = await request<{ runs: RewardRun[] }>('/api/runs');
  return response.runs;
}

export async function startRewardRun(taskId: string, packMode: PackMode): Promise<RewardRun> {
  return request('/api/runs', {
    method: 'POST',
    body: JSON.stringify({ task_id: taskId, pack_mode: packMode }),
  });
}

export async function loadRewardRun(runId: string): Promise<RewardRun> {
  return request(`/api/runs/${encodeURIComponent(runId)}`);
}

export async function cancelRewardRun(runId: string): Promise<RewardRun> {
  return request(`/api/runs/${encodeURIComponent(runId)}/cancel`, {
    method: 'POST',
    body: '{}',
  });
}
