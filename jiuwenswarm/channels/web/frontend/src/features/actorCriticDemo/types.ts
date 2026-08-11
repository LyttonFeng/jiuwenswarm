export type PackMode =
  | 'rebuild_answer_blind'
  | 'rebuild_gold_assisted';

export interface RewardTaskPreset {
  task_id: string;
  title: string;
  repo_slug: string;
  base_commit: string;
  issue: string;
  available_pack_modes: PackMode[];
}

export interface RewardRuntimeInfo {
  actor_model: string;
  builder_model: string;
  critic_model: string;
  execution: string;
}

export interface RewardPackStatus {
  available: boolean;
  verified: boolean;
  probe_count: number;
  passed: number;
  answer_blind: boolean;
}

export interface ActorStatus {
  started: boolean;
  turns_reviewed: number;
  interventions: number;
  tool_calls: number;
  latest_hint: string;
  latest_confidence: number | null;
  completed: boolean;
}

export interface PatchStatus {
  available: boolean;
  preview: string;
  bytes: number;
}

export interface GraderStatus {
  available: boolean;
  complete: boolean;
  resolved: number;
  unresolved: number;
  errors: number;
}

export interface RewardRun {
  run_id: string;
  task: RewardTaskPreset;
  pack_mode: PackMode;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  phase: 'queued' | 'workspace' | 'rewardpack' | 'actor' | 'grader' | 'complete';
  phase_index: number;
  message: string;
  workspace_path?: string;
  created_at: number;
  updated_at: number;
  finished_at?: number;
  process_running?: boolean;
  process_exit_code?: number | null;
  rewardpack: RewardPackStatus;
  actor: ActorStatus;
  patch: PatchStatus;
  grader: GraderStatus;
}
