import type {
  PackMode,
  RewardChatRoute,
  RewardRun,
  RewardRuntimeInfo,
  RewardTaskPreset,
} from './types';

const API_BASE = (
  import.meta.env.VITE_SWARM_REWARD_API_BASE || 'http://127.0.0.1:8765'
).replace(/\/$/, '');
const EXPECTED_PROTOCOL_VERSION = 'swarm_reward.web_chat.v2';

function assertProtocol(version: string): void {
  if (version !== EXPECTED_PROTOCOL_VERSION) {
    throw new Error(`Swarm Reward protocol mismatch: expected ${EXPECTED_PROTOCOL_VERSION}, got ${version || 'missing'}`);
  }
}

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
  const response = await request<{ ok: true; protocol_version: string }>('/health');
  assertProtocol(response.protocol_version);
}

export async function loadRewardTasks(): Promise<{
  tasks: RewardTaskPreset[];
  runtime: RewardRuntimeInfo;
  protocol_version: string;
}> {
  const response = await request<{
    tasks: RewardTaskPreset[];
    runtime: RewardRuntimeInfo;
    protocol_version: string;
  }>('/api/tasks');
  assertProtocol(response.protocol_version);
  return response;
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

export async function routeRewardMessage(
  message: string,
  context: {
    selected_task_id: string | null;
    active_run: Pick<RewardRun, 'run_id' | 'status' | 'phase'> | null;
  },
): Promise<RewardChatRoute> {
  return request('/api/chat/route', {
    method: 'POST',
    body: JSON.stringify({ message, ...context }),
  });
}
