import type { RewardChatRoute } from './types';

export type SwarmRewardSubmitRoute =
  | { kind: 'demo'; route: RewardChatRoute }
  | { kind: 'general' }
  | { kind: 'unavailable'; error: unknown };

/**
 * Resolve the submission owner before either chat path mutates its store.
 * Only an explicit `general` decision may fall through to Jiuwen's normal Agent.
 */
export async function resolveSwarmRewardSubmitRoute(
  routeMessage: () => Promise<RewardChatRoute>,
): Promise<SwarmRewardSubmitRoute> {
  try {
    const route = await routeMessage();
    return route.scope === 'general'
      ? { kind: 'general' }
      : { kind: 'demo', route };
  } catch (error) {
    return { kind: 'unavailable', error };
  }
}
