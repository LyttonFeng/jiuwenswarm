import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveSwarmRewardSubmitRoute } from '../node_modules/.cache/swarm-reward-submit-routing/features/actorCriticDemo/swarmRewardSubmitRouting.js';

test('only an explicit general route falls through to the normal Agent', async () => {
  const result = await resolveSwarmRewardSubmitRoute(async () => ({
    scope: 'general',
    intent: null,
    task_id: null,
    pack_mode: null,
    answer: null,
  }));

  assert.deepEqual(result, { kind: 'general' });
});

test('a Demo route stays in the Swarm Reward controller', async () => {
  const route = {
    scope: 'demo',
    intent: 'rewardpack_status',
    task_id: 'django__django-12325',
    pack_mode: null,
    answer: null,
  };
  const result = await resolveSwarmRewardSubmitRoute(async () => route);

  assert.deepEqual(result, { kind: 'demo', route });
});

test('router failure is fail-closed instead of executing the normal Agent', async () => {
  const failure = new Error('v6 service unavailable');
  const result = await resolveSwarmRewardSubmitRoute(async () => {
    throw failure;
  });

  assert.equal(result.kind, 'unavailable');
  assert.equal(result.error, failure);
});
