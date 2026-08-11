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
  law_id: string;
  boundary: {
    mode: string;
    teacher_gold_access: boolean;
    actor_gold_access: boolean;
    hidden_tests_used: boolean;
  };
  criteria: Array<{
    id: string;
    role: 'terminal' | 'constraint' | 'shaping' | string;
    question: string;
    probe_ids: string[];
  }>;
  probes: Array<{
    id: string;
    criterion_ids: string[];
    description: string;
    verification_mode: string;
    expectations: Array<{ scenario: string; outcome: string }>;
    admitted: boolean;
  }>;
}

export interface RewardTimelineEvent {
  id: string;
  stage: 'rewardpack' | 'actor' | 'grader';
  kind: 'builder_round' | 'rewardpack_certified' | 'actor_critic_turn' | 'actor_hint_action' | 'actor_action' | 'critic_intervention' | 'actor_final' | 'grader_result';
  title: string;
  detail: string;
  status: 'running' | 'completed' | 'revised';
  decision?: 'speak' | 'silent';
  metrics?: {
    state_value: number | null;
    actor_q: number | null;
    actor_advantage: number | null;
    revision_q: number | null;
    predicted_hint_gain: number | null;
    revision_relation: string;
    confidence: number | null;
    criterion_scores: Array<{ criterion_id: string; score: number | null; constraint_status: string }>;
  };
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
  operation?: 'build_rewardpack' | 'solve';
  rewardpack_source_run_id?: string | null;
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
  timeline: RewardTimelineEvent[];
}

export type RewardChatIntent =
  | 'task_context'
  | 'start_run'
  | 'build_rewardpack'
  | 'replay_run'
  | 'rewardpack_status'
  | 'rewardpack_content'
  | 'sandbox_status'
  | 'progress'
  | 'patch'
  | 'critic'
  | 'grader'
  | 'explain'
  | 'dashboard'
  | 'cancel';

export interface RewardChatRoute {
  scope: 'demo' | 'general';
  intent: RewardChatIntent | null;
  task_id: string | null;
  pack_mode: PackMode | null;
}
