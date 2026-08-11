import type { RewardChatIntent, RewardExecutionEnvironment, RewardRun } from './types';

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
  if (run.status === 'failed' && !run.actor.started) {
    return [
      `任务 **${run.task.task_id}** 的 online Actor-Critic **没有启动成功**。`,
      '',
      'Actor 尚未产生任何动作，Critic 也没有审阅；这是运行环境或启动编排失败，**不是 issue 未解决的实验结论**。',
      '',
      `服务状态：${run.message}`,
    ].join('\n');
  }
  if (run.status === 'failed' && !run.grader.complete) {
    return [
      `任务 **${run.task.task_id}** 的运行在官方评分前中断。`,
      '',
      `Actor 已执行 ${run.actor.tool_calls} 次工具调用，Critic 已审阅 ${run.actor.turns_reviewed} 次；由于没有官方 grader 结果，本次不能判定 resolved 或 unresolved。`,
      '',
      `服务状态：${run.message}`,
    ].join('\n');
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

export function sandboxStatus(run: RewardRun): string {
  if (run.phase === 'queued') {
    return `**${run.task.task_id}** 的远端沙箱尚未开始准备。当前状态：${run.message}`;
  }
  if (run.phase === 'workspace' && !isTerminal(run)) {
    return `**${run.task.task_id}** 的远端沙箱正在搭建和冻结。当前状态：${run.message}`;
  }
  if (isTerminal(run) && !run.rewardpack.verified && !run.actor.started) {
    return `**${run.task.task_id}** 的本次沙箱准备没有完成。运行状态：${run.status}；${run.message}`;
  }
  const verification = run.grader.complete
    ? `官方 Docker grader 已在该环境完成执行：${run.grader.resolved} resolved，${run.grader.unresolved} unresolved，${run.grader.errors} error。`
    : run.rewardpack.verified
      ? `RewardPack 的 ${run.rewardpack.passed}/${run.rewardpack.probe_count} 条 probe 已在该环境通过沙箱认证。`
      : '冻结工作区已经进入后续执行阶段。';
  return [
    `**${run.task.task_id} 的远端沙箱已经搭建并验证可用。**`,
    '',
    `- 仓库：${run.task.repo_slug}`,
    `- 冻结基线：\`${run.task.base_commit}\``,
    `- 运行隔离：远端 Docker 沙箱`,
    `- 验证证据：${verification}`,
    '',
    '这次只是查询状态，没有启动新的 Builder 或 Actor-Critic 运行。',
  ].join('\n');
}

export function environmentStatus(environment: RewardExecutionEnvironment): string {
  const docker = environment.docker.available
    ? `可用（Server ${environment.docker.server_version}）`
    : '不可用';
  const gpu = environment.gpu.devices.length
    ? environment.gpu.devices
      .map((device) => `${device.name} · ${(device.memory_mib / 1024).toFixed(0)} GiB`)
      .join('；')
    : '未检测到';
  const disk = environment.workspace.free_gib === null
    ? '未知'
    : `${environment.workspace.free_gib.toFixed(1)} GiB 可用`;
  const verdict = environment.available
    ? '当前远端 coding 执行环境可用。'
    : '当前远端 coding 执行环境未完全就绪。';
  return [
    `**${verdict}**`,
    '',
    `- Docker：${docker}`,
    `- GPU：${gpu}`,
    `- 已缓存 SWE 实例镜像：${environment.swebench.cached_instance_images}`,
    `- 实验工作区：${environment.workspace.available ? '可写' : '不可用'}，${disk}`,
    '',
    '以上是执行服务所在资源提供者的实时只读探测，不是 Mac 本机状态；本次查询没有启动 Builder 或 Actor-Critic。',
  ].join('\n');
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
  if (intent === 'sandbox_status') return sandboxStatus(run);
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
