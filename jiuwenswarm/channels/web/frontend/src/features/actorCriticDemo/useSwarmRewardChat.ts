import { useCallback, useEffect, useRef, useState } from 'react';
import { useChatStore } from '../../stores';
import type { MediaItem, ToolCall } from '../../types';
import {
  cancelRewardRun,
  loadLatestRewardPack,
  loadRecentRuns,
  loadRewardRun,
  loadRewardTasks,
  routeRewardMessage,
  startActorCriticFromRewardPack,
  startRewardPackBuild,
  startRewardRun,
} from './api';
import {
  STAGES,
  STAGE_LABELS,
  TOOL_NAMES,
  answerForIntent,
  finalSummary,
  isTerminal,
  progressStatus,
  rewardPackContent,
  stageResult,
  type Stage,
} from './swarmRewardChatProtocol';
import type { PackMode, RewardRun, RewardTaskPreset, RewardTimelineEvent } from './types';

const POLL_INTERVAL_MS = 1_500;
const WELCOME_MESSAGE_ID = 'swarm-reward-welcome';

type Progress = {
  runId: string;
  activeStage: Stage | null;
  completedStages: Set<Stage>;
  latestHint: string;
  publishedEvents: Map<string, string>;
  terminalPublished: boolean;
};

export type SwarmRewardChatController = {
  enabled: boolean;
  activeTaskId: string;
  send: (content: string, mediaItems?: MediaItem[]) => Promise<boolean>;
  cancel: () => Promise<void>;
};

function timestamp(): string {
  return new Date().toISOString();
}

export function useSwarmRewardChat(
  enabled: boolean,
  sessionId: string,
): SwarmRewardChatController {
  const [tasks, setTasks] = useState<RewardTaskPreset[]>([]);
  const [recentRuns, setRecentRuns] = useState<RewardRun[]>([]);
  const [selectedTask, setSelectedTask] = useState<RewardTaskPreset | null>(null);
  const [run, setRun] = useState<RewardRun | null>(null);
  const progressRef = useRef<Progress | null>(null);
  const catalogPromiseRef = useRef<Promise<{
    tasks: RewardTaskPreset[];
    recentRuns: RewardRun[];
  }> | null>(null);

  const ensureCatalog = useCallback(async () => {
    if (!catalogPromiseRef.current) {
      catalogPromiseRef.current = Promise.all([loadRewardTasks(), loadRecentRuns()])
        .then(([catalog, recent]) => ({ tasks: catalog.tasks, recentRuns: recent }))
        .catch((reason) => {
          catalogPromiseRef.current = null;
          throw reason;
        });
    }
    const catalog = await catalogPromiseRef.current;
    setTasks(catalog.tasks);
    setRecentRuns(catalog.recentRuns);
    return catalog;
  }, []);

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
    const label = stage === 'rewardpack' && next.rewardpack_source_run_id
      ? '校验并载入已认证 RewardPack'
      : STAGE_LABELS[stage];
    const toolCall: ToolCall = {
      id: `${next.run_id}-${stage}`,
      name: TOOL_NAMES[stage],
      display_name: label,
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

  const publishTimelineEvent = useCallback((event: RewardTimelineEvent, next: RewardRun) => {
    const progress = progressRef.current;
    if (!progress) return;
    const previousStatus = progress.publishedEvents.get(event.id);
    if (!previousStatus) {
      if (event.kind === 'critic_intervention') {
        addMessage('assistant', `**${event.title}**\n\n> ${event.detail}`);
      } else {
        useChatStore.getState().addToolCall(sessionId, {
          id: `${next.run_id}-${event.id}`,
          name: `swarm_reward.${event.kind}`,
          display_name: event.title,
          arguments: { stage: event.stage, evidence: event.detail },
        });
      }
    }
    if (event.kind !== 'critic_intervention' && event.status !== 'running' && previousStatus !== event.status) {
      useChatStore.getState().addToolResult(sessionId, {
        toolName: `swarm_reward.${event.kind}`,
        toolCallId: `${next.run_id}-${event.id}`,
        result: event.detail,
        success: event.status === 'completed',
        summary: event.title,
      });
      if (event.kind === 'rewardpack_certified' && !previousStatus) {
        addMessage('assistant', next.rewardpack_source_run_id
          ? `已按内容哈希校验并载入 **${next.rewardpack.passed}/${next.rewardpack.probe_count} probes** 的冻结 RewardPack。现在开始 online Actor-Critic；Actor 与 Critic 不会看到 Gold patch。`
          : rewardPackContent(next));
      }
    }
    progress.publishedEvents.set(event.id, event.status);
  }, [addMessage, sessionId]);

  const publishRun = useCallback((next: RewardRun) => {
    if (!progressRef.current || progressRef.current.runId !== next.run_id) {
      progressRef.current = {
        runId: next.run_id,
        activeStage: null,
        completedStages: new Set<Stage>(),
        latestHint: '',
        publishedEvents: new Map<string, string>(),
        terminalPublished: false,
      };
    }
    const phase = STAGES.includes(next.phase as Stage) ? next.phase as Stage : null;
    if (phase) openStage(phase, next);
    const progress = progressRef.current;
    for (const event of next.timeline || []) publishTimelineEvent(event, next);
    const timelineHasCritic = (next.timeline || []).some((event) => event.kind === 'critic_intervention');
    if (!timelineHasCritic && next.actor.latest_hint && next.actor.latest_hint !== progress.latestHint) {
      progress.latestHint = next.actor.latest_hint;
      addMessage('assistant', `**Critic 介入**\n\n> ${next.actor.latest_hint}`);
    }
    if (isTerminal(next)) publishTerminal(next);
  }, [addMessage, openStage, publishTerminal, publishTimelineEvent]);

  const replayRun = useCallback((next: RewardRun) => {
    setSelectedTask(next.task);
    progressRef.current = {
      runId: next.run_id,
      activeStage: null,
      completedStages: new Set<Stage>(),
      latestHint: '',
      publishedEvents: new Map<string, string>(),
      terminalPublished: false,
    };
    addMessage('assistant', '下面回放一条**已经冻结并由官方 grader 验证**的真实运行。它不是新的模型采样。');
    for (const stage of STAGES) {
      openStage(stage, next);
      completeStage(stage, next);
    }
    for (const event of next.timeline || []) publishTimelineEvent(event, next);
    publishTerminal(next);
    setRun(next);
  }, [addMessage, completeStage, openStage, publishTerminal, publishTimelineEvent]);

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
          '告诉我你想解决的仓库 issue，我会准备冻结工作区、构建 RewardPack，并启动 Actor-Critic。',
          '',
          '例如：`帮我解决 django__django-12325`。如果只想先看结果，可以说：`看看 12325 的演示运行`。',
          '',
          'Gold-assisted 仅用于 RewardPack Builder；Actor 与 Critic 不会看到 Gold patch。',
        ].join('\n'),
      });
    }
    let active = true;
    void ensureCatalog()
      .catch((reason) => {
        if (!active) return;
        addMessage('system', `Swarm Reward 执行服务未连接：${reason instanceof Error ? reason.message : String(reason)}`);
      });
    return () => {
      active = false;
    };
  }, [addMessage, enabled, ensureCatalog, sessionId]);

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

  const beginRun = useCallback(async (task: RewardTaskPreset, mode: PackMode) => {
    setSelectedTask(task);
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

  const beginBuild = useCallback(async (task: RewardTaskPreset, mode: PackMode) => {
    setSelectedTask(task);
    useChatStore.getState().setProcessing(sessionId, true);
    useChatStore.getState().setThinking(sessionId, true);
    addMessage('assistant', `开始为 **${task.task_id}** 构建 ${mode === 'rebuild_gold_assisted' ? 'Gold-assisted' : 'Answer-blind'} RewardPack。构建轮次与沙箱认证结果会实时显示在这里；本次不会自动启动 Actor。`);
    try {
      const next = await startRewardPackBuild(task.task_id, mode);
      setRun(next);
      publishRun(next);
    } catch (reason) {
      useChatStore.getState().setProcessing(sessionId, false);
      useChatStore.getState().setThinking(sessionId, false);
      addMessage('system', `RewardPack 构建启动失败：${reason instanceof Error ? reason.message : String(reason)}`);
    }
  }, [addMessage, publishRun, sessionId]);

  const beginFromPack = useCallback(async (task: RewardTaskPreset, source: RewardRun) => {
    setSelectedTask(task);
    useChatStore.getState().setProcessing(sessionId, true);
    useChatStore.getState().setThinking(sessionId, true);
    addMessage('assistant', `RewardPack 已认证（**${source.rewardpack.passed}/${source.rewardpack.probe_count} probes**）。现在跳过 Builder，按内容哈希复用这份 Pack，直接启动 **Actor-Critic**。`);
    try {
      const next = await startActorCriticFromRewardPack(task.task_id);
      setRun(next);
      publishRun(next);
    } catch (reason) {
      useChatStore.getState().setProcessing(sessionId, false);
      useChatStore.getState().setThinking(sessionId, false);
      addMessage('system', `Actor-Critic 启动失败：${reason instanceof Error ? reason.message : String(reason)}`);
    }
  }, [addMessage, publishRun, sessionId]);

  const send = useCallback(async (content: string, mediaItems?: MediaItem[]) => {
    const trimmed = content.trim();
    if (!enabled || !trimmed) return false;
    let handled = false;
    let keepProcessing = Boolean(run && !isTerminal(run));
    addMessage('user', trimmed, mediaItems);
    useChatStore.getState().setProcessing(sessionId, true);
    useChatStore.getState().setThinking(sessionId, true);

    try {
      let availableTasks = tasks;
      let availableRuns = recentRuns;
      if (availableTasks.length === 0) {
        const catalog = await ensureCatalog();
        availableTasks = catalog.tasks;
        availableRuns = catalog.recentRuns;
      }

      const route = await routeRewardMessage(trimmed, {
        selected_task_id: run?.task.task_id || selectedTask?.task_id || null,
        active_run: run ? {
          run_id: run.run_id,
          status: run.status,
          phase: run.phase,
        } : null,
      });
      if (route.scope === 'general') return false;

      handled = true;
      const routedTask = availableTasks.find((item) => item.task_id === route.task_id) || null;
      if (routedTask) setSelectedTask(routedTask);
      const task = routedTask || run?.task || selectedTask;

      if (route.intent === 'start_run') {
        if (!task) {
          addMessage('assistant', `我还不能确定任务。当前可用任务：${availableTasks.map((item) => `\`${item.task_id}\``).join('、')}。`);
          return true;
        }
        if (run && !isTerminal(run)) {
          addMessage('assistant', progressStatus(run));
          return true;
        }
        const existingPack = [run, ...availableRuns].find((item) =>
          item?.task.task_id === task.task_id && item.rewardpack.verified,
        );
        if (existingPack) {
          keepProcessing = true;
          await beginFromPack(task, existingPack);
          return true;
        }
        const requestedMode = route.pack_mode;
        const mode = requestedMode && task.available_pack_modes.includes(requestedMode)
          ? requestedMode
          : task.available_pack_modes.includes('rebuild_gold_assisted')
            ? 'rebuild_gold_assisted'
            : task.available_pack_modes[0] || 'rebuild_answer_blind';
        keepProcessing = true;
        await beginRun(task, mode);
        return true;
      }

      if (route.intent === 'build_rewardpack') {
        if (!task) {
          addMessage('assistant', '请先告诉我需要为哪项任务构建 RewardPack。');
          return true;
        }
        if (run && !isTerminal(run)) {
          addMessage('assistant', progressStatus(run));
          return true;
        }
        const requestedMode = route.pack_mode;
        const mode = requestedMode && task.available_pack_modes.includes(requestedMode)
          ? requestedMode
          : task.available_pack_modes.includes('rebuild_gold_assisted')
            ? 'rebuild_gold_assisted'
            : task.available_pack_modes[0] || 'rebuild_answer_blind';
        keepProcessing = true;
        await beginBuild(task, mode);
        return true;
      }

      if (route.intent === 'replay_run') {
        if (!task) {
          addMessage('assistant', '请告诉我想查看哪项任务的演示运行。');
          return true;
        }
        const frozen = availableRuns.find((item) => item.task.task_id === task.task_id && item.status === 'completed');
        if (!frozen) {
          addMessage('assistant', `没有找到 **${task.task_id}** 的已完成运行。你可以直接让我开始解决它。`);
          return true;
        }
        replayRun(await loadRewardRun(frozen.run_id));
        return true;
      }

      if (route.intent === 'cancel') {
        if (!run || isTerminal(run)) {
          addMessage('assistant', '当前没有正在执行的 Demo 运行。');
          return true;
        }
        const next = await cancelRewardRun(run.run_id);
        setRun(next);
        publishRun(next);
        return true;
      }

      if (route.intent === 'task_context' && task) {
        addMessage('assistant', [
          `我已经载入 **${task.task_id}**（${task.repo_slug}）。`,
          '',
          `> ${task.issue}`,
          '',
          `当前会话会一直保留这个任务上下文。你可以直接让我开始，或者继续追问目标行为、RewardPack、Critic 和评分，不需要再重复 task id。`,
        ].join('\n'));
        return true;
      }

      if (route.intent === 'rewardpack_status' && task) {
        if (run && !isTerminal(run)) {
          addMessage('assistant', rewardPackContent(run));
          return true;
        }
        let source = [run, ...availableRuns].find((item) =>
          item?.task.task_id === task.task_id && item.rewardpack.verified,
        ) || null;
        if (!source) {
          try {
            source = await loadLatestRewardPack(task.task_id);
          } catch {
            source = null;
          }
        } else {
          source = await loadLatestRewardPack(task.task_id);
        }
        if (!source) {
          addMessage('assistant', `**${task.task_id}** 还没有通过认证的 RewardPack。你可以让我现在构建。`);
          return true;
        }
        addMessage('assistant', rewardPackContent(source));
        keepProcessing = true;
        await beginFromPack(task, source);
        return true;
      }

      const frozen = task
        ? availableRuns.find((item) => item.task.task_id === task.task_id && item.status === 'completed')
        : null;
      const referenceRun = run || (frozen ? await loadRewardRun(frozen.run_id) : null);
      if (referenceRun && route.intent) {
        setRun(referenceRun);
        setSelectedTask(referenceRun.task);
        const answer = answerForIntent(route.intent, referenceRun);
        if (answer) {
          addMessage('assistant', answer);
          return true;
        }
      }

      addMessage('assistant', task
        ? `**${task.task_id}** 还没有可供查询的运行。你可以让我现在开始。`
        : `我还不能确定你指的是哪项 Demo 任务。当前可用任务：${availableTasks.map((item) => `\`${item.task_id}\``).join('、')}。`);
      return true;
    } catch (reason) {
      if (!handled) {
        console.warn('Swarm Reward semantic router unavailable; using normal Jiuwen agent.', reason);
        return false;
      }
      addMessage('system', `Demo 执行服务尚未就绪：${reason instanceof Error ? reason.message : String(reason)}`);
      return true;
    } finally {
      if (!keepProcessing) {
        useChatStore.getState().setProcessing(sessionId, false);
        useChatStore.getState().setThinking(sessionId, false);
      }
    }
  }, [addMessage, beginBuild, beginFromPack, beginRun, enabled, ensureCatalog, publishRun, recentRuns, replayRun, run, selectedTask, sessionId, tasks]);

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
    activeTaskId: run?.task.task_id || selectedTask?.task_id || '',
    send,
    cancel: cancelRun,
  };
}
