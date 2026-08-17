import assert from 'node:assert/strict';
import test from 'node:test';

import {
  agentContextForRun,
  finalSummary,
  rewardPackContent,
} from '../node_modules/.cache/actor-critic-demo/swarmRewardChatProtocol.mjs';

function runFixture() {
  return {
    run_id: 'demo-run',
    task: {
      task_id: 'django__django-12325',
      title: 'Django 12325',
      repo_slug: 'django/django',
      base_commit: 'abc',
      issue: 'Fix the issue.',
      available_pack_modes: ['rebuild_with_successful_witness'],
    },
    pack_mode: 'rebuild_with_successful_witness',
    status: 'completed',
    phase: 'complete',
    phase_index: 4,
    message: 'complete',
    created_at: 1,
    updated_at: 2,
    rewardpack: {
      available: true,
      verified: true,
      rewardpack_id: 'django-12325.rewardpack',
      probe_count: 1,
      passed: 1,
      construction: {
        successful_witness_used: true,
        successful_witness_source: 'dataset',
        experience_view_sha256: '',
      },
      boundary: {
        successful_witness_visible_to_actor: false,
        hidden_tests_used: false,
        official_grader_feedback_used: false,
      },
      criteria: [{ id: 'goal', role: 'terminal', question: 'Goal?', probe_ids: ['p1'] }],
      probes: [{
        id: 'p1',
        criterion_ids: ['goal'],
        description: 'Public behavior probe.',
        verification_mode: 'sandbox',
        expectations: [{ scenario: 'repository-base', outcome: 'reject' }],
        admitted: true,
      }],
    },
    actor: {
      started: true,
      turns_reviewed: 1,
      critic_errors: 0,
      interventions: 1,
      tool_calls: 2,
      latest_hint: '',
      latest_confidence: null,
      completed: true,
    },
    patch: { available: true, preview: 'diff', bytes: 4 },
    grader: { available: true, complete: true, resolved: 1, unresolved: 0, errors: 0 },
    timeline: [{
      id: 'turn-1',
      stage: 'actor',
      kind: 'actor_critic_turn',
      title: 'Actor-Critic Turn 1 · speak',
      detail: 'reviewed',
      status: 'completed',
      decision: 'speak',
      metrics: {
        actor_success_value: 0.2,
        revision_success_value: 0.8,
        counterfactual_advantage: 0.6,
        intervention_threshold: 0.01,
        confidence: 0.9,
        frontier: ['goal'],
        environment_veto: false,
        regressed_requirements: [],
        state_trace: ['OBSERVE', 'VALUE'],
        model_calls: ['proposer', 'transition', 'value_critic'],
      },
    }],
  };
}

test('v6 RewardPack copy preserves the successful-witness authority boundary', () => {
  const content = rewardPackContent(runFixture());
  assert.match(content, /Builder 使用成功 witness/);
  assert.match(content, /witness 不对 Actor\/Critic 可见/);
  assert.doesNotMatch(content, /Answer-blind|Gold-assisted/);
});

test('demo summary prefers the frozen Pack and saved trajectory', () => {
  const summary = finalSummary(runFixture());
  assert.match(summary, /已保存轨迹：1 个 Actor-Critic turn/);
  assert.match(summary, /1\/1 resolved/);
  assert.match(summary, /未使用 hidden tests/);
});

test('agent Q&A context exposes verified run evidence without a witness body', () => {
  const context = agentContextForRun(runFixture());
  assert.match(context, /<swarm_reward_run_context>/);
  assert.match(context, /Fix the issue/);
  assert.match(context, /Official grader: 1 resolved/);
  assert.match(context, /Final patch:\ndiff/);
  assert.match(context, /successful witness may have been used/);
  assert.doesNotMatch(context, /successful-witness\.patch|gold patch/i);
});

test('Code Normal baseline is reported without RewardPack or Critic claims', () => {
  const baseline = {
    ...runFixture(),
    operation: 'baseline',
    rewardpack: {
      ...runFixture().rewardpack,
      available: false,
      verified: false,
      probe_count: 0,
      passed: 0,
      criteria: [],
      probes: [],
    },
    actor: {
      ...runFixture().actor,
      turns_reviewed: 0,
      interventions: 0,
      tool_calls: 42,
    },
    grader: { available: true, complete: true, resolved: 0, unresolved: 1, errors: 0 },
    timeline: [],
  };
  const summary = finalSummary(baseline);
  assert.match(summary, /Code Normal baseline/);
  assert.match(summary, /RewardPack：未启用/);
  assert.match(summary, /Critic：未启用/);
  assert.match(summary, /0\/1 resolved/);

  const context = agentContextForRun(baseline);
  assert.match(context, /<code_normal_baseline_context>/);
  assert.match(context, /no RewardPack; no Critic/);
  assert.doesNotMatch(context, /<swarm_reward_run_context>/);
});
