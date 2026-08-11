import type { RewardChatIntent, RewardRun } from './types';

export type Stage = 'workspace' | 'rewardpack' | 'actor' | 'grader';

export const STAGES: Stage[] = ['workspace', 'rewardpack', 'actor', 'grader'];

export const TOOL_NAMES: Record<Stage, string> = {
  workspace: 'swarm_reward.load_workspace',
  rewardpack: 'swarm_reward.build_rewardpack',
  actor: 'swarm_reward.actor_critic',
  grader: 'swarm_reward.official_grader',
};

export const STAGE_LABELS: Record<Stage, string> = {
  workspace: '载入冻结工作区',
  rewardpack: '构建并认证 RewardPack',
  actor: 'Actor-Critic 修复',
  grader: '官方 Docker grader',
};

export function isTerminal(run: RewardRun): boolean {
  return ['completed', 'failed', 'cancelled'].includes(run.status);
}

export function stageResult(run: RewardRun, stage: Stage): string {
  if (stage === 'workspace') return `工作区已就绪：${run.workspace_path || '/testbed'}`;
  if (stage === 'rewardpack') {
    return run.rewardpack.verified
      ? `RewardPack 已认证：${run.rewardpack.passed}/${run.rewardpack.probe_count} probes 通过。`
      : 'RewardPack 未通过认证。';
  }
  if (stage === 'actor') {
    return `Actor 完成 ${run.actor.tool_calls} 次工具调用；Critic 审阅 ${run.actor.turns_reviewed} 次，介入 ${run.actor.interventions} 次。`;
  }
  return run.grader.complete
    ? `官方评分：${run.grader.resolved} resolved，${run.grader.unresolved} unresolved，${run.grader.errors} error。`
    : '官方评分未完成。';
}

export function finalSummary(run: RewardRun): string {
  if (run.operation === 'build_rewardpack') {
    return run.rewardpack.verified
      ? `任务 **${run.task.task_id}** 的 RewardPack 已构建、通过沙箱认证并冻结：**${run.rewardpack.passed}/${run.rewardpack.probe_count} probes**。你可以查看内容，或让我用它启动 Actor-Critic。`
      : `RewardPack 构建已结束，但没有通过认证。状态：**${run.status}**。`;
  }
  const verdict = run.grader.complete
    ? `**${run.grader.resolved}/1 resolved**`
    : `运行状态：**${run.status}**`;
  const packBoundary = run.pack_mode === 'rebuild_gold_assisted'
    ? 'Builder 使用 Gold；Actor 与 Critic 未看到 Gold。'
    : 'RewardPack、Actor 与 Critic 均未使用 Gold。';
  return [
    `任务 **${run.task.task_id}** 已结束，官方结果为 ${verdict}。`,
    '',
    `- RewardPack：${run.rewardpack.passed}/${run.rewardpack.probe_count} probes`,
    `- Actor：${run.actor.tool_calls} 次工具调用`,
    `- Critic：${run.actor.turns_reviewed} 次审阅，${run.actor.interventions} 次介入`,
    `- 实验边界：${packBoundary}`,
    '',
    `你可以继续问：**解释改动**、**查看补丁**、**Critic 为什么介入**、**查看评分**，或让我重新运行。`,
    '',
    `[打开独立实验仪表盘](/swarm-reward?run=${encodeURIComponent(run.run_id)})`,
  ].join('\n');
}

export function rewardPackStatus(run: RewardRun): string {
  if (run.rewardpack.verified) {
    const phase = run.phase === 'complete'
      ? '已完成'
      : STAGES.includes(run.phase as Stage) ? STAGE_LABELS[run.phase as Stage] : '任务排队';
    return `RewardPack 已构建并通过沙箱认证：**${run.rewardpack.passed}/${run.rewardpack.probe_count} probes**。当前链路状态：**${phase}**。`;
  }
  if (run.phase === 'rewardpack') return `RewardPack 正在构建和沙箱认证，当前状态：${run.message}`;
  if (run.phase === 'queued' || run.phase === 'workspace') {
    return `还没有。当前正在准备冻结工作区，随后会构建 RewardPack。状态：${run.message}`;
  }
  return `RewardPack 尚未通过认证。当前运行状态为 **${run.status}**：${run.message}`;
}

const ROLE_LABELS: Record<string, string> = {
  terminal: 'Goal',
  constraint: 'Preservation',
  shaping: 'Solution',
};

export function rewardPackContent(run: RewardRun): string {
  const pack = run.rewardpack;
  if (!pack.verified) return rewardPackStatus(run);
  const criteria = pack.criteria.map((criterion) => [
    `### ${ROLE_LABELS[criterion.role] || criterion.role} · ${criterion.id}`,
    '',
    criterion.question,
  ].join('\n')).join('\n\n');
  const probes = pack.probes.map((probe) => {
    const matrix = probe.expectations
      .map((item) => `${item.scenario}→${item.outcome}`)
      .join('，');
    return `- ${probe.admitted ? '✅' : '⚠️'} **${probe.id}** · ${probe.verification_mode || 'unknown'}\n  ${probe.description}${matrix ? `（${matrix}）` : ''}`;
  }).join('\n');
  const boundary = pack.boundary.teacher_gold_access
    ? 'Gold-assisted Builder；Actor/Critic 无 Gold；未使用 hidden tests'
    : 'Answer-blind Builder/Actor/Critic；未使用 hidden tests';
  return [
    `## RewardPack · ${run.task.task_id}`,
    '',
    `**认证：${pack.passed}/${pack.probe_count} probes · ${boundary}**`,
    '',
    criteria,
    '',
    '### 已认证 probes',
    '',
    probes || '- 暂无 probe',
  ].join('\n');
}

export function progressStatus(run: RewardRun): string {
  if (isTerminal(run)) return finalSummary(run);
  const phase = STAGES.includes(run.phase as Stage) ? STAGE_LABELS[run.phase as Stage] : '任务排队';
  return [
    `任务 **${run.task.task_id}** 正在运行，目前处于 **${phase}**。`,
    '',
    run.message,
    '',
    `RewardPack ${run.rewardpack.verified ? `${run.rewardpack.passed}/${run.rewardpack.probe_count} 已认证` : '尚未认证'}；Actor 已执行 ${run.actor.tool_calls} 次工具调用；Critic 已审阅 ${run.actor.turns_reviewed} 次。`,
  ].join('\n');
}

export function answerForIntent(intent: RewardChatIntent, run: RewardRun): string | null {
  if (intent === 'rewardpack_status') return rewardPackStatus(run);
  if (intent === 'rewardpack_content') return rewardPackContent(run);
  if (intent === 'progress') return progressStatus(run);
  if (intent === 'patch') {
    return run.patch.available
      ? `这是 Actor 的最终可交付补丁：\n\n\`\`\`diff\n${run.patch.preview}\n\`\`\``
      : '这次运行还没有形成可交付补丁。';
  }
  if (intent === 'critic') {
    const hint = run.actor.latest_hint
      ? `\n\n最后一条 fresh hint：\n\n> ${run.actor.latest_hint}`
      : '\n\n目前没有需要注入 Actor 的 hint。';
    return `Critic 共审阅 **${run.actor.turns_reviewed}** 个 pending action，介入 **${run.actor.interventions}** 次。${hint}`;
  }
  if (intent === 'grader') {
    return run.grader.complete
      ? `官方 Docker grader：**${run.grader.resolved}/1 resolved**，${run.grader.unresolved} unresolved，${run.grader.errors} error。`
      : '官方 grader 尚未完成。';
  }
  if (intent === 'explain') {
    return [
      `这次修复围绕公开 issue **${run.task.task_id}** 展开。`,
      '',
      `RewardPack 先把目标行为编译为 ${run.rewardpack.probe_count} 个可执行验收 probe；Actor 在仓库中自然求解；Critic 只审阅尚未执行的 consequential action，并在正 advantage 时注入 fresh hint。最终补丁由官方 grader 独立验证为 **${run.grader.resolved}/1 resolved**。`,
      '',
      run.patch.available ? `最终 diff：\n\n\`\`\`diff\n${run.patch.preview}\n\`\`\`` : '本次没有最终 diff。',
    ].join('\n');
  }
  if (intent === 'dashboard') {
    return `[打开这次运行的独立实验仪表盘](/swarm-reward?run=${encodeURIComponent(run.run_id)})`;
  }
  return null;
}
