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
  const reviewedTurns = run.timeline.filter((event) => event.kind === 'actor_critic_turn').length;
  return [
    `任务 **${run.task.task_id}** 已结束，官方结果为 ${verdict}。`,
    '',
    `- RewardPack：${run.rewardpack.passed}/${run.rewardpack.probe_count} probes`,
    `- Actor：${run.actor.tool_calls} 次工具调用`,
    `- Critic：${run.actor.turns_reviewed} 次审阅，${run.actor.interventions} 次介入`,
    `- 已保存轨迹：${reviewedTurns} 个 Actor-Critic turn，可逐轮展开`,
    `- 实验边界：${packBoundary}`,
    '',
    `你可以继续问：**解释改动**、**查看补丁**、**Critic 为什么介入**、**查看评分**，或让我重新运行。`,
    '',
    `[在对话中回放 Actor-Critic 轨迹](/chat/new?mode=swarm-reward&run=${encodeURIComponent(run.run_id)})`,
    '',
    `[打开独立实验仪表盘](/swarm-reward?run=${encodeURIComponent(run.run_id)})`,
  ].join('\n');
}

export function rewardPackStatus(run: RewardRun): string {
  if (run.rewardpack.verified) {
    return `RewardPack 已构建、通过沙箱认证并冻结：**${run.rewardpack.passed}/${run.rewardpack.probe_count} probes**。它可以复用于 Actor-Critic；本次状态查询没有启动新的运行。`;
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
  const gpuGroups = environment.gpu.devices.reduce<Record<string, { count: number; memory: number | null }>>(
    (groups, device) => {
      const group = groups[device.name] || { count: 0, memory: device.memory_mib };
      group.count += 1;
      groups[device.name] = group;
      return groups;
    },
    {},
  );
  const gpu = Object.entries(gpuGroups).length
    ? Object.entries(gpuGroups)
      .map(([name, group]) => `${group.count} × ${name}${group.memory === null ? '' : ` · ${(group.memory / 1024).toFixed(0)} GiB/卡`}`)
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

function actorCriticExplanation(run: RewardRun): string {
  const reviewed = run.timeline.filter((event) => event.kind === 'actor_critic_turn');
  const valued = reviewed.filter((event) => event.metrics?.state_value != null);
  const interventions = reviewed.filter((event) => event.decision === 'speak');
  const valueRows = valued.map((event) => {
    const metrics = event.metrics!;
    const turn = event.title.match(/Turn (\d+)/)?.[1] || '?';
    const number = (value: number | null) => value === null ? '—' : value.toFixed(3);
    return `| ${turn} | ${number(metrics.state_value)} | ${number(metrics.actor_q)} | ${number(metrics.actor_advantage)} | ${number(metrics.revision_q)} | ${number(metrics.predicted_hint_gain)} | ${event.decision || 'silent'} |`;
  }).join('\n');
  const boundary = run.rewardpack.boundary.teacher_gold_access
    ? 'Builder 可见 Gold；冻结后 Actor 与 Critic 不可见 Gold；未使用 hidden tests。'
    : 'Builder、Actor 与 Critic 均 answer-blind；未使用 hidden tests。';
  const grader = run.grader.complete
    ? `${run.grader.resolved}/1 resolved，${run.grader.unresolved} unresolved，${run.grader.errors} error`
    : '尚未完成';

  return [
    `## RewardPack-guided online Actor-Critic · ${run.task.task_id}`,
    '',
    '**这不是经典 one-step Actor-Critic，也不是在线训练模型参数。** 它是在 coding inference 期间、工具执行之前运行的动作控制回路；RewardPack 是冻结的任务奖励合同，不使用 embedding memory。',
    '',
    '### 一轮控制逻辑',
    '',
    '1. Actor 从当前状态 $s_t$ 产生一个**尚未执行**的真实工具动作 $a_t$。状态只包含公开 issue、冻结 RewardPack、当前 worktree 与已经执行的可见证据。',
    '2. 只读低风险动作可由语义 Router 快速放行；需要审阅的动作交给 Proposer 产生一个 grounded revision $\\tilde a_t$。',
    '3. 独立 Value Critic 从同一个 $s_t$ 评价：$V(s_t)$、$Q(s_t,a_t)$ 与 $Q(s_t,\\tilde a_t)$。候选顺序被盲化，Critic 不知道哪一个来自 Actor。',
    '4. Controller 确定性计算 $A_{actor}=Q(s_t,a_t)-V(s_t)$ 和 predicted hint gain $\\Delta_t=Q(s_t,\\tilde a_t)-Q(s_t,a_t)$。revision 还必须可执行、repo-grounded，并与 RewardPack 要求的条件和边界相容。',
    '5. 若合同有效且 $\\Delta_t$ 超过阈值，Controller **speak**：丢弃原 pending action，只注入当前 fresh hint，让同一 Actor 重新采样；否则 **silent**：原动作不变地执行。',
    '6. 工具结果成为 $s_{t+1}$ 的新证据。模型 reasoning 在本次调用后丢弃，不进入 Actor 历史、RewardPack 或网页。',
    '',
    '### 本次真实运行',
    '',
    `- RewardPack：${run.rewardpack.passed}/${run.rewardpack.probe_count} 条 sandbox-certified probes`,
    `- Actor：${run.actor.tool_calls} 次工具调用`,
    `- Critic：${reviewed.length} 次动作决策；${interventions.length} 次 speak（${interventions.map((event) => event.title.match(/Turn (\d+)/)?.[1]).filter(Boolean).map((turn) => `Turn ${turn}`).join('、') || '无'}）`,
    `- 官方 grader：${grader}`,
    `- 实验边界：${boundary}`,
    '',
    ...(valueRows ? [
      '### 有完整价值估计的回合',
      '',
      '| Turn | V(s) | Q(actor) | A(actor) | Q(revision) | hint gain | decision |',
      '|---:|---:|---:|---:|---:|---:|:---|',
      valueRows,
      '',
    ] : []),
    '页面中的已保存轨迹可以逐轮展开，查看 pending action、speak/silent、fresh hint 与执行证据。',
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
    return actorCriticExplanation(run);
  }
  if (intent === 'dashboard') {
    return `[打开这次运行的独立实验仪表盘](/swarm-reward?run=${encodeURIComponent(run.run_id)})`;
  }
  return null;
}
