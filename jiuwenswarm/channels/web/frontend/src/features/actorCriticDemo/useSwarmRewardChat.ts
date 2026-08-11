import { useCallback, useEffect, useRef, useState } from 'react';
import { useChatStore } from '../../stores';
import type { MediaItem, ToolCall } from '../../types';
import {
  cancelRewardRun,
  loadRecentRuns,
  loadRewardRun,
  loadRewardTasks,
  startRewardRun,
} from './api';
import type { PackMode, RewardRun, RewardTaskPreset } from './types';

const POLL_INTERVAL_MS = 1_500;
const WELCOME_MESSAGE_ID = 'swarm-reward-welcome';

type Stage = 'workspace' | 'rewardpack' | 'actor' | 'grader';

const STAGES: Stage[] = ['workspace', 'rewardpack', 'actor', 'grader'];

const TOOL_NAMES: Record<Stage, string> = {
  workspace: 'swarm_reward.load_workspace',
  rewardpack: 'swarm_reward.build_rewardpack',
  actor: 'swarm_reward.actor_critic',
  grader: 'swarm_reward.official_grader',
};

const STAGE_LABELS: Record<Stage, string> = {
  workspace: '载入冻结工作区',
  rewardpack: '构建并认证 RewardPack',
  actor: 'Actor-Critic 修复',
  grader: '官方 Docker grader',
};

type Progress = {
  runId: string;
  activeStage: Stage | null;
  completedStages: Set<Stage>;
  latestHint: string;
  terminalPublished: boolean;
};

export type SwarmRewardChatController = {
  enabled: boolean;
  activeTaskId: string;
  send: (content: string, mediaItems?: MediaItem[]) => Promise<void>;
  cancel: () => Promise<void>;
};

function timestamp(): string {
  return new Date().toISOString();
}

function normalizeTaskIdentity(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function isTerminal(run: RewardRun): boolean {
  return ['completed', 'failed', 'cancelled'].includes(run.status);
}

function wantsReplay(content: string): boolean {
  return /(?:回放|复现|演示|已完成|历史运行)/i.test(content);
}

function wantsFreshRun(content: string): boolean {
  return /(?:重新求解|重新运行|新运行|从头运行|开始修复|请解决|请修复|再跑)/i.test(content);
}

function preferredMode(content: string, task: RewardTaskPreset): PackMode {
  if (/answer[ -]?blind|未知题|不看\s*gold/i.test(content)
      && task.available_pack_modes.includes('rebuild_answer_blind')) {
    return 'rebuild_answer_blind';
  }
  if (task.available_pack_modes.includes('rebuild_gold_assisted')) {
    return 'rebuild_gold_assisted';
  }
  return task.available_pack_modes[0] || 'rebuild_answer_blind';
}

function matchTask(content: string, tasks: RewardTaskPreset[]): RewardTaskPreset | null {
  const normalized = normalizeTaskIdentity(content);
  const exact = tasks.find((task) => normalized.includes(normalizeTaskIdentity(task.task_id)));
  if (exact) return exact;
  const byTitle = tasks.find((task) => normalized.includes(normalizeTaskIdentity(task.title)));
  if (byTitle) return byTitle;
  return tasks.length === 1 && /django|issue|任务|修复|演示|运行/i.test(content) ? tasks[0] : null;
}

function stageResult(run: RewardRun, stage: Stage): string {
  if (stage === 'workspace') {
    return `工作区已就绪：${run.workspace_path || '/testbed'}`;
  }
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

function finalSummary(run: RewardRun): string {
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
    `你可以继续问：**解释改动**、**查看补丁**、**Critic 为什么介入**、**查看评分**，或输入 **重新运行 ${run.task.task_id}**。`,
    '',
    `[打开独立实验仪表盘](/swarm-reward?run=${encodeURIComponent(run.run_id)})`,
  ].join('\n');
}

function followupAnswer(content: string, run: RewardRun): string | null {
  if (/(?:补丁|patch|diff|改了什么)/i.test(content)) {
    return run.patch.available
      ? `这是 Actor 的最终可交付补丁：\n\n\`\`\`diff\n${run.patch.preview}\n\`\`\``
      : '这次运行没有形成可交付补丁。';
  }
  if (/(?:critic|hint|干预|介入|审阅)/i.test(content)) {
    const hint = run.actor.latest_hint
      ? `\n\n最后一条 fresh hint：\n\n> ${run.actor.latest_hint}`
      : '\n\n本次没有产生需要注入 Actor 的 hint。';
    return `Critic 共审阅 **${run.actor.turns_reviewed}** 个 pending action，介入 **${run.actor.interventions}** 次。${hint}`;
  }
  if (/(?:评分|grader|结果|成功|resolved)/i.test(content)) {
    return run.grader.complete
      ? `官方 Docker grader：**${run.grader.resolved}/1 resolved**，${run.grader.unresolved} unresolved，${run.grader.errors} error。`
      : '官方 grader 尚未完成。';
  }
  if (/(?:解释|为什么|原理)/i.test(content)) {
    return [
      `这次修复围绕公开 issue **${run.task.task_id}** 展开。`,
      '',
      `RewardPack 先把目标行为编译为 ${run.rewardpack.probe_count} 个可执行验收 probe；Actor 在仓库中自然求解；Critic 只审阅尚未执行的 consequential action，并在正 advantage 时注入 fresh hint。最终补丁由官方 grader 独立验证为 **${run.grader.resolved}/1 resolved**。`,
      '',
      run.patch.available ? `最终 diff：\n\n\`\`\`diff\n${run.patch.preview}\n\`\`\`` : '本次没有最终 diff。',
    ].join('\n');
  }
  if (/(?:详情|仪表盘|证据)/i.test(content)) {
    return `[打开这次运行的独立实验仪表盘](/swarm-reward?run=${encodeURIComponent(run.run_id)})`;
  }
  return null;
}

export function useSwarmRewardChat(
  enabled: boolean,
  sessionId: string,
): SwarmRewardChatController {
  const [tasks, setTasks] = useState<RewardTaskPreset[]>([]);
  const [recentRuns, setRecentRuns] = useState<RewardRun[]>([]);
  const [run, setRun] = useState<RewardRun | null>(null);
  const progressRef = useRef<Progress | null>(null);

  const addMessage = useCallback((role: 'user' | 'assistant' | 'system', content: string, mediaItems?: MediaItem[]) => {
    useChatStore.getState().addMessage(sessionId, {
      id: `swarm-reward-${role}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      role,
      content,
      timestamp: timestamp(),
      ...(mediaItems?.length ? { mediaItems } : {}),
    });
  }, [sessionId]);

  const completeStage = useCallback((stage: Stage, next: RewardRun) => {
    const progress = progressRef.current;
    if (!progress || progress.completedStages.has(stage)) return;
    useChatStore.getState().addToolResult(sessionId, {
      toolName: TOOL_NAMES[stage],
      toolCallId: `${next.run_id}-${stage}`,
      result: stageResult(next, stage),
      success: next.status !== 'failed',
      summary: STAGE_LABELS[stage],
    });
    progress.completedStages.add(stage);
  }, [sessionId]);

  const openStage = useCallback((stage: Stage, next: RewardRun) => {
    const progress = progressRef.current;
    if (!progress || progress.activeStage === stage || progress.completedStages.has(stage)) return;
    if (progress.activeStage) completeStage(progress.activeStage, next);
    const toolCall: ToolCall = {
      id: `${next.run_id}-${stage}`,
      name: TOOL_NAMES[stage],
      display_name: STAGE_LABELS[stage],
      arguments: {
        task_id: next.task.task_id,
        pack_mode: next.pack_mode,
      },
    };
    useChatStore.getState().addToolCall(sessionId, toolCall);
    progress.activeStage = stage;
  }, [completeStage, sessionId]);

  const publishTerminal = useCallback((next: RewardRun) => {
    const progress = progressRef.current;
    if (!progress || progress.terminalPublished) return;
    if (progress.activeStage) completeStage(progress.activeStage, next);
    progress.terminalPublished = true;
    useChatStore.getState().setProcessing(sessionId, false);
    useChatStore.getState().setThinking(sessionId, false);
    addMessage(next.status === 'failed' ? 'system' : 'assistant', finalSummary(next));
  }, [addMessage, completeStage, sessionId]);

  const publishRun = useCallback((next: RewardRun) => {
    if (!progressRef.current || progressRef.current.runId !== next.run_id) {
      progressRef.current = {
        runId: next.run_id,
        activeStage: null,
        completedStages: new Set<Stage>(),
        latestHint: '',
        terminalPublished: false,
      };
    }
    const phase = STAGES.includes(next.phase as Stage) ? next.phase as Stage : null;
    if (phase) openStage(phase, next);
    const progress = progressRef.current;
    if (next.actor.latest_hint && next.actor.latest_hint !== progress.latestHint) {
      progress.latestHint = next.actor.latest_hint;
      addMessage('assistant', `**Critic 介入**\n\n> ${next.actor.latest_hint}`);
    }
    if (isTerminal(next)) publishTerminal(next);
  }, [addMessage, openStage, publishTerminal]);

  const replayRun = useCallback((next: RewardRun) => {
    progressRef.current = {
      runId: next.run_id,
      activeStage: null,
      completedStages: new Set<Stage>(),
      latestHint: '',
      terminalPublished: false,
    };
    addMessage('assistant', '下面回放一条**已经冻结并由官方 grader 验证**的真实运行。它不是新的模型采样。');
    for (const stage of STAGES) {
      openStage(stage, next);
      completeStage(stage, next);
    }
    if (next.actor.latest_hint) {
      progressRef.current.latestHint = next.actor.latest_hint;
      addMessage('assistant', `**Critic 介入**\n\n> ${next.actor.latest_hint}`);
    }
    publishTerminal(next);
    setRun(next);
  }, [addMessage, completeStage, openStage, publishTerminal]);

  useEffect(() => {
    if (!enabled) return;
    const store = useChatStore.getState();
    store.ensureRuntime(sessionId);
    store.setActiveSessionId(sessionId);
    const hasWelcome = store.getRuntime(sessionId)?.messages.some((message) => message.id === WELCOME_MESSAGE_ID);
    if (!hasWelcome) {
      store.addMessage(sessionId, {
        id: WELCOME_MESSAGE_ID,
        role: 'assistant',
        timestamp: timestamp(),
        content: [
          '**Swarm Reward Coding Agent 已就绪。**',
          '',
          '请在下方输入仓库任务，例如：',
          '',
          '- `演示 django__django-12325`：立即回放已冻结的真实成功运行；',
          '- `请解决 django__django-12325`：在远端沙箱启动一次新的完整求解。',
          '',
          'Gold-assisted 仅用于 RewardPack Builder；Actor 与 Critic 不会看到 Gold patch。',
        ].join('\n'),
      });
    }
    let active = true;
    void Promise.all([loadRewardTasks(), loadRecentRuns()])
      .then(([catalog, recent]) => {
        if (!active) return;
        setTasks(catalog.tasks);
        setRecentRuns(recent);
      })
      .catch((reason) => {
        if (!active) return;
        addMessage('system', `Swarm Reward 执行服务未连接：${reason instanceof Error ? reason.message : String(reason)}`);
      });
    return () => {
      active = false;
    };
  }, [addMessage, enabled, sessionId]);

  useEffect(() => {
    if (!enabled || !run || isTerminal(run)) return;
    const timer = window.setInterval(() => {
      void loadRewardRun(run.run_id)
        .then((next) => {
          setRun(next);
          publishRun(next);
        })
        .catch((reason) => {
          addMessage('system', `刷新运行状态失败：${reason instanceof Error ? reason.message : String(reason)}`);
        });
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [addMessage, enabled, publishRun, run]);

  const beginRun = useCallback(async (task: RewardTaskPreset, content: string) => {
    const mode = preferredMode(content, task);
    useChatStore.getState().setProcessing(sessionId, true);
    useChatStore.getState().setThinking(sessionId, true);
    addMessage('assistant', `已接管 **${task.task_id}**。正在远端沙箱启动新的 ${mode === 'rebuild_gold_assisted' ? 'Gold-assisted' : 'Answer-blind'} 完整链路。`);
    try {
      const next = await startRewardRun(task.task_id, mode);
      setRun(next);
      publishRun(next);
    } catch (reason) {
      useChatStore.getState().setProcessing(sessionId, false);
      useChatStore.getState().setThinking(sessionId, false);
      addMessage('system', `任务启动失败：${reason instanceof Error ? reason.message : String(reason)}`);
    }
  }, [addMessage, publishRun, sessionId]);

  const send = useCallback(async (content: string, mediaItems?: MediaItem[]) => {
    const trimmed = content.trim();
    if (!enabled || !trimmed) return;
    addMessage('user', trimmed, mediaItems);

    const task = matchTask(trimmed, tasks) || run?.task || null;
    if (wantsFreshRun(trimmed)) {
      if (!task) {
        addMessage('assistant', `我还不能确定任务。当前可用任务：${tasks.map((item) => `\`${item.task_id}\``).join('、') || '服务仍在载入'}。`);
        return;
      }
      await beginRun(task, trimmed);
      return;
    }

    if (!run && wantsReplay(trimmed)) {
      if (!task) {
        addMessage('assistant', '请同时给出要回放的 task id，例如 `演示 django__django-12325`。');
        return;
      }
      const frozen = recentRuns.find((item) => item.task.task_id === task.task_id && item.status === 'completed');
      if (!frozen) {
        addMessage('assistant', `没有找到 **${task.task_id}** 的已完成运行。输入 \`请解决 ${task.task_id}\` 可以启动新运行。`);
        return;
      }
      replayRun(await loadRewardRun(frozen.run_id));
      return;
    }

    if (run) {
      const answer = followupAnswer(trimmed, run);
      if (answer) {
        addMessage('assistant', answer);
        return;
      }
    }

    if (task) {
      addMessage('assistant', `已识别任务 **${task.task_id}**。输入 \`演示 ${task.task_id}\` 可立即查看真实冻结运行；输入 \`请解决 ${task.task_id}\` 会启动新的远端求解。`);
      return;
    }
    addMessage('assistant', `请给出 task id。当前可用任务：${tasks.map((item) => `\`${item.task_id}\``).join('、') || '正在载入'}。`);
  }, [addMessage, beginRun, enabled, recentRuns, replayRun, run, tasks]);

  const cancelRun = useCallback(async () => {
    if (!run || isTerminal(run)) return;
    try {
      const next = await cancelRewardRun(run.run_id);
      setRun(next);
      publishRun(next);
    } catch (reason) {
      addMessage('system', `停止任务失败：${reason instanceof Error ? reason.message : String(reason)}`);
    }
  }, [addMessage, publishRun, run]);

  return {
    enabled,
    activeTaskId: run?.task.task_id || '',
    send,
    cancel: cancelRun,
  };
}
