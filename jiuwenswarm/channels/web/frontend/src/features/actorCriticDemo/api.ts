import type {
  PackMode,
  RewardChatRoute,
  RewardExecutionEnvironment,
  RewardRun,
  RewardRuntimeInfo,
  RewardTaskPreset,
} from './types';

const API_BASE = (
  import.meta.env.VITE_SWARM_REWARD_API_BASE || '/swarm-reward-api'
).replace(/\/$/, '');
const EXPECTED_PROTOCOL_VERSION = 'swarm_reward.web_chat.v6';

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

function normalizeRun(run: RewardRun): RewardRun {
  return {
    ...run,
    rewardpack: {
      ...run.rewardpack,
      harness: run.rewardpack.harness || {
        registry_sha256: '',
        execution: 'fresh networkless Docker replay',
        executable_probes: run.rewardpack.probe_count || 0,
      },
    },
    actor: {
      ...run.actor,
      critic_errors: run.actor.critic_errors ?? 0,
    },
    comparison: run.comparison || {
      available: false,
      campaign_id: '',
      headline: '',
      a_value: null,
      a_classification: '',
      b_value: null,
      b_classification: '',
      online_actor_critic_seconds: 0,
      official_grader_seconds: 0,
      end_to_end_seconds: 0,
      rewardpack_fingerprint_sha256: '',
      policy_fingerprint_sha256: '',
      official_grader: false,
    },
    timeline: run.timeline || [],
  };
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
  return response.runs.map(normalizeRun);
}

export async function loadRewardEnvironment(): Promise<RewardExecutionEnvironment> {
  return request('/api/environment');
}

export async function startRewardRun(taskId: string, packMode: PackMode): Promise<RewardRun> {
  return normalizeRun(await request('/api/runs', {
    method: 'POST',
    body: JSON.stringify({ task_id: taskId, pack_mode: packMode }),
  }));
}

export async function startRewardPackBuild(taskId: string, packMode: PackMode): Promise<RewardRun> {
  return normalizeRun(await request('/api/rewardpacks', {
    method: 'POST',
    body: JSON.stringify({ task_id: taskId, pack_mode: packMode }),
  }));
}

export async function loadLatestRewardPack(taskId: string): Promise<RewardRun> {
  return normalizeRun(await request(`/api/rewardpacks/latest?task_id=${encodeURIComponent(taskId)}`));
}

export async function startActorCriticFromRewardPack(taskId: string): Promise<RewardRun> {
  return normalizeRun(await request('/api/runs/from-rewardpack', {
    method: 'POST',
    body: JSON.stringify({ task_id: taskId }),
  }));
}

export async function loadRewardRun(runId: string): Promise<RewardRun> {
  return normalizeRun(await request(`/api/runs/${encodeURIComponent(runId)}`));
}

export async function cancelRewardRun(runId: string): Promise<RewardRun> {
  return normalizeRun(await request(`/api/runs/${encodeURIComponent(runId)}/cancel`, {
    method: 'POST',
    body: '{}',
  }));
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
