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

/**
 * A pinned Demo page already knows the task and execution mode.
 * An explicit solve command must not depend on the semantic router.
 */
export function isPinnedTaskSolveRequest(message: string): boolean {
  const namesTask = /django(?:[\s_-]*django)?[\s_-]*\d+/i.test(message);
  const asksToRun = /解决|求解|开始|执行|运行/.test(message)
    || /\b(?:solve|start|run)\b/i.test(message);
  return namesTask && asksToRun;
}
