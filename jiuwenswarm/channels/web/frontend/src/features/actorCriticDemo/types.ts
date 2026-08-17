export type PackMode =
  | 'rebuild_fresh'
  | 'rebuild_with_successful_witness';

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

export interface RewardExecutionEnvironment {
  schema_version: 'swarm_reward.execution_environment.v1';
  available: boolean;
  provider: string;
  docker: { available: boolean; server_version: string };
  gpu: {
    available: boolean;
    devices: Array<{ name: string; memory_mib: number | null }>;
  };
  swebench: { cached_instance_images: number };
  workspace: { available: boolean; free_gib: number | null };
}

export interface RewardPackStatus {
  available: boolean;
  verified: boolean;
  rewardpack_id: string;
  probe_count: number;
  passed: number;
  construction: {
    successful_witness_used: boolean;
    successful_witness_source: string;
    experience_view_sha256: string;
  };
  boundary: {
    successful_witness_visible_to_actor: boolean;
    hidden_tests_used: boolean;
    official_grader_feedback_used: boolean;
  };
  harness: {
    registry_sha256: string;
    execution: string;
    executable_probes: number;
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
  kind: 'teacher_role' | 'builder_round' | 'rewardpack_certified' | 'actor_critic_turn' | 'actor_hint_action' | 'actor_action' | 'critic_intervention' | 'actor_final' | 'grader_result';
  title: string;
  detail: string;
  status: 'running' | 'completed' | 'revised' | 'failed' | 'timed_out';
  decision?: 'speak' | 'silent' | 'error';
  metrics?: {
    actor_success_value: number | null;
    revision_success_value: number | null;
    counterfactual_advantage: number | null;
    intervention_threshold: number | null;
    confidence: number | null;
    frontier: string[];
    environment_veto: boolean;
    regressed_requirements: string[];
    state_trace: string[];
    model_calls: string[];
  };
}

export interface ActorStatus {
  started: boolean;
  turns_reviewed: number;
  critic_errors: number;
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

export interface ComparisonStatus {
  available: boolean;
  campaign_id: string;
  headline: string;
  a_value: 0 | 1 | null;
  a_classification: string;
  b_value: 0 | 1 | null;
  b_classification: string;
  online_actor_critic_seconds: number;
  official_grader_seconds: number;
  end_to_end_seconds: number;
  rewardpack_fingerprint_sha256: string;
  policy_fingerprint_sha256: string;
  official_grader: boolean;
}

export interface RewardRun {
  run_id: string;
  task: RewardTaskPreset;
  pack_mode: PackMode;
  operation?: 'baseline' | 'build_rewardpack' | 'solve';
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
  comparison: ComparisonStatus;
  timeline: RewardTimelineEvent[];
}

export type RewardChatIntent =
  | 'task_context'
  | 'start_run'
  | 'build_rewardpack'
  | 'replay_run'
  | 'rewardpack_status'
  | 'rewardpack_content'
  | 'environment_status'
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
  answer: string | null;
}
