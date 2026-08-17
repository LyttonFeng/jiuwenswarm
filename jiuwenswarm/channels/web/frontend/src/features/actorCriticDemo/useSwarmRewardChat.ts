import { useCallback, useEffect, useRef, useState } from 'react';
import { useChatStore } from '../../stores';
import type { MediaItem, ToolCall } from '../../types';
import {
  cancelRewardRun,
  loadLatestRewardPack,
  loadRecentRuns,
  loadRewardEnvironment,
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
  agentContextForRun,
  answerForIntent,
  environmentStatus,
  finalSummary,
  isTerminal,
  progressStatus,
  rewardPackContent,
  rewardPackStatus,
  stageResult,
  type Stage,
} from './swarmRewardChatProtocol';
import { resolveSwarmRewardSubmitRoute } from './swarmRewardSubmitRouting';
import type { PackMode, RewardRun, RewardTaskPreset, RewardTimelineEvent } from './types';

const POLL_INTERVAL_MS = 1_500;
const WELCOME_MESSAGE_ID = 'swarm-reward-welcome';

export type RewardRunPresentation = 'swarm_reward' | 'code_normal_baseline';

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
  takeAgentContext: () => string | null;
  cancel: () => Promise<void>;
};

const AGENT_QA_INTENTS = new Set([
  'task_context',
  'rewardpack_content',
  'patch',
  'critic',
  'grader',
  'explain',
]);

function timestamp(): string {
  return new Date().toISOString();
}

type DisplayEventStatus = RewardTimelineEvent['status'] | 'failed' | 'cancelled';

/** 已终止的 run 不能在历史回放中留下「正在执行」的幽灵事件。 */
function displayEventStatus(event: RewardTimelineEvent, run: RewardRun): DisplayEventStatus {
  if (event.status !== 'running' || !isTerminal(run)) return event.status;
  if (run.status === 'completed') return 'completed';
  const eventIndex = STAGES.indexOf(event.stage);
  const phaseIndex = STAGES.indexOf(run.phase as Stage);
  if (phaseIndex >= 0 && eventIndex < phaseIndex) return 'completed';
  return run.status === 'cancelled' ? 'cancelled' : 'failed';
}

export function useSwarmRewardChat(
  enabled: boolean,
  sessionId: string,
  initialRunId: string | null = null,
  presentation: RewardRunPresentation = 'swarm_reward',
): SwarmRewardChatController {
  const [tasks, setTasks] = useState<RewardTaskPreset[]>([]);
  const [recentRuns, setRecentRuns] = useState<RewardRun[]>([]);
  const [selectedTask, setSelectedTask] = useState<RewardTaskPreset | null>(null);
  const [run, setRun] = useState<RewardRun | null>(null);
  const progressRef = useRef<Progress | null>(null);
  const replayedRunRef = useRef<string | null>(null);
  const pendingAgentContextRef = useRef<string | null>(null);
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
    const cancelled = next.status === 'cancelled' && next.phase === stage;
    const failed = next.status === 'failed' && next.phase === stage;
    useChatStore.getState().addToolResult(sessionId, {
      toolName: TOOL_NAMES[stage],
      toolCallId: `${next.run_id}-${stage}`,
      result: stageResult(next, stage),
      success: !failed && !cancelled,
      ...(cancelled ? { cancelled: true } : {}),
      summary: STAGE_LABELS[stage],
    });
    progress.completedStages.add(stage);
  }, [sessionId]);

  const openStage = useCallback((stage: Stage, next: RewardRun) => {
    const progress = progressRef.current;
    if (!progress || progress.activeStage === stage || progress.completedStages.has(stage)) return;
    if (progress.activeStage) completeStage(progress.activeStage, next);
    const baseline = next.operation === 'baseline';
    const label = baseline && stage === 'actor'
      ? 'Code Normal 独立解题'
      : stage === 'rewardpack' && next.rewardpack_source_run_id
      ? '校验并载入已认证 RewardPack'
      : STAGE_LABELS[stage];
    const toolCall: ToolCall = {
      id: `${next.run_id}-${stage}`,
      name: baseline && stage === 'actor' ? 'jiuwenswarm.code_normal' : TOOL_NAMES[stage],
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
    const visibleStatus = displayEventStatus(event, next);
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
    if (event.kind !== 'critic_intervention' && visibleStatus !== 'running' && previousStatus !== visibleStatus) {
      const cancelled = visibleStatus === 'cancelled';
      useChatStore.getState().addToolResult(sessionId, {
        toolName: `swarm_reward.${event.kind}`,
        toolCallId: `${next.run_id}-${event.id}`,
        result: event.detail,
        success: visibleStatus === 'completed' || visibleStatus === 'revised',
        ...(cancelled ? { cancelled: true } : {}),
        summary: event.title,
      });
      if (event.kind === 'rewardpack_certified' && !previousStatus) {
        addMessage('assistant', next.rewardpack_source_run_id
          ? `已按内容哈希校验并载入 **${next.rewardpack.passed}/${next.rewardpack.probe_count} probes** 的冻结 RewardPack。现在开始 online Actor-Critic；Actor 与 Critic 不会看到构建时的成功 witness。`
          : rewardPackContent(next));
      }
    }
    progress.publishedEvents.set(event.id, visibleStatus);
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
    const replayBoundary = next.grader.complete
      ? '下面回放一条**已经冻结并由官方 grader 验证**的真实运行。它不是新的模型采样。'
      : next.status === 'cancelled'
        ? '下面回放一条**由用户停止、未进入官方 grader**的真实运行记录。它不是新的模型采样。'
        : '下面回放一条**在官方评分前结束**的真实运行记录。它不是新的模型采样。';
    addMessage('assistant', replayBoundary);
    const terminalStageIndex = STAGES.indexOf(next.phase as Stage);
    const availableStages = next.operation === 'baseline'
      ? STAGES.filter((stage) => stage !== 'rewardpack')
      : STAGES;
    const replayStages = isTerminal(next) && next.status !== 'completed' && terminalStageIndex >= 0
      ? availableStages.filter((stage) => STAGES.indexOf(stage) <= terminalStageIndex)
      : availableStages;
    for (const stage of replayStages) {
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
    const welcomeId = presentation === 'code_normal_baseline'
      ? 'code-normal-baseline-welcome'
      : WELCOME_MESSAGE_ID;
    const hasWelcome = store.getRuntime(sessionId)?.messages.some((message) => message.id === welcomeId);
    if (!hasWelcome) {
      store.addMessage(sessionId, {
        id: welcomeId,
        role: 'assistant',
        timestamp: timestamp(),
        content: presentation === 'code_normal_baseline' ? [
          '**JiuwenSwarm Code Normal 已就绪。**',
          '',
          '这是单一 DSV4-Flash Actor 的 baseline 运行视图，不加载 RewardPack，也不启用 Critic。',
          '',
          '页面只展示远端 SWE 沙箱中的真实工具轨迹和官方 grader 结果。',
        ].join('\n') : [
          '**Swarm Reward Coding Agent 已就绪。**',
          '',
          '告诉我你想解决的仓库 issue。系统会优先载入已认证的冻结 RewardPack，再启动 Actor-Critic。',
          '',
          '例如：`帮我解决 django__django-12325`。如果只想先看结果，可以说：`看看 12325 的演示运行`。',
          '',
          '如果没有可复用 Pack，Builder 可以使用成功 witness 重新构建；Actor 与 Critic 不可见 witness。',
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
  }, [addMessage, enabled, ensureCatalog, presentation, sessionId]);

  useEffect(() => {
    if (!enabled || !initialRunId || replayedRunRef.current === initialRunId) return;
    replayedRunRef.current = initialRunId;
    void loadRewardRun(initialRunId)
      .then((next) => {
        if (presentation === 'code_normal_baseline' && next.operation !== 'baseline') {
          throw new Error('该链接不是 Code Normal baseline 运行');
        }
        setSelectedTask(next.task);
        setRun(next);
        addMessage('assistant', presentation === 'code_normal_baseline' ? [
          `已载入 **${next.task.task_id}** 的真实 Code Normal baseline。`,
          '',
          '- Actor：DSV4-Flash（单 Agent）',
          '- RewardPack：未启用',
          '- Critic：未启用',
          `- 官方 grader：${next.grader.complete ? `${next.grader.resolved}/1 resolved` : '未完成'}`,
          '',
          '你可以问：**它做了什么？**、**最终补丁是什么？**、**官方评分结果如何？**。',
        ].join('\n') : [
          `已载入 **${next.task.task_id}** 的真实运行上下文。`,
          '',
          '你可以直接提问，JiuwenSwarm 会结合冻结 RewardPack、Actor–Critic 轨迹、最终补丁和官方 grader 证据实时回答。',
          '',
          '例如：**这个任务为什么难？**、**Critic 为什么介入？**、**最终改了什么？**。只有你明确要求“展示轨迹”时，才会展开完整历史回放。',
        ].join('\n'));
      })
      .catch((reason) => {
        replayedRunRef.current = null;
        addMessage('system', `无法载入运行 ${initialRunId}：${reason instanceof Error ? reason.message : String(reason)}`);
      });
  }, [addMessage, enabled, initialRunId, presentation]);

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
    addMessage('assistant', `已接管 **${task.task_id}**。没有可复用的冻结 Pack，正在远端沙箱${mode === 'rebuild_with_successful_witness' ? '使用成功 witness ' : ''}构建并执行完整链路。`);
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
    addMessage('assistant', `开始为 **${task.task_id}** ${mode === 'rebuild_with_successful_witness' ? '使用成功 witness ' : '从当前任务证据'}构建 RewardPack。构建轮次与沙箱认证结果会实时显示在这里；本次不会自动启动 Actor。`);
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
    pendingAgentContextRef.current = null;
    const submission = await resolveSwarmRewardSubmitRoute(() => routeRewardMessage(trimmed, {
      selected_task_id: run?.task.task_id || selectedTask?.task_id || null,
      active_run: run ? {
        run_id: run.run_id,
        status: run.status,
        phase: run.phase,
      } : null,
    }));
    if (submission.kind === 'general') return false;

    if (
      submission.kind === 'demo'
      && run
      && submission.route.intent
      && AGENT_QA_INTENTS.has(submission.route.intent)
    ) {
      pendingAgentContextRef.current = agentContextForRun(run);
      return false;
    }

    let keepProcessing = Boolean(run && !isTerminal(run));
    addMessage('user', trimmed, mediaItems);
    if (submission.kind === 'unavailable') {
      addMessage('system', `Swarm Reward 路由服务未连接；本条消息没有交给普通 Agent 执行：${submission.error instanceof Error ? submission.error.message : String(submission.error)}`);
      return true;
    }

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

      const route = submission.route;
      if (
        presentation === 'code_normal_baseline'
        && (route.intent === 'start_run' || route.intent === 'build_rewardpack')
      ) {
        addMessage('assistant', run
          ? finalSummary(run)
          : '这个入口只展示已冻结的 Code Normal baseline，不会启动 RewardPack 或 Actor-Critic。');
        return true;
      }
      if (route.intent === 'environment_status') {
        addMessage('assistant', environmentStatus(await loadRewardEnvironment()));
        return true;
      }
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
          : task.available_pack_modes.includes('rebuild_with_successful_witness')
            ? 'rebuild_with_successful_witness'
            : task.available_pack_modes[0] || 'rebuild_fresh';
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
          : task.available_pack_modes.includes('rebuild_with_successful_witness')
            ? 'rebuild_with_successful_witness'
            : task.available_pack_modes[0] || 'rebuild_fresh';
        keepProcessing = true;
        await beginBuild(task, mode);
        return true;
      }

      if (route.intent === 'replay_run') {
        if (presentation === 'code_normal_baseline' && run?.operation === 'baseline') {
          replayRun(await loadRewardRun(run.run_id));
          return true;
        }
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
        addMessage('assistant', route.answer?.trim() || [
          `**${task.task_id}**（${task.repo_slug}）`,
          '',
          task.issue,
        ].join('\n'));
        return true;
      }

      if (route.intent === 'rewardpack_status' && task) {
        if (run && !isTerminal(run)) {
          addMessage('assistant', rewardPackStatus(run));
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
        addMessage('assistant', rewardPackStatus(source));
        return true;
      }

      const frozen = task
        ? availableRuns.find((item) => item.task.task_id === task.task_id && item.status === 'completed')
        : null;
      let referenceRun = run;
      if (referenceRun) {
        referenceRun = await loadRewardRun(referenceRun.run_id);
      } else if (frozen) {
        referenceRun = await loadRewardRun(frozen.run_id);
      }
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
      addMessage('system', `Demo 执行服务尚未就绪：${reason instanceof Error ? reason.message : String(reason)}`);
      return true;
    } finally {
      if (!keepProcessing) {
        useChatStore.getState().setProcessing(sessionId, false);
        useChatStore.getState().setThinking(sessionId, false);
      }
    }
  }, [addMessage, beginBuild, beginFromPack, beginRun, enabled, ensureCatalog, presentation, publishRun, recentRuns, replayRun, run, selectedTask, sessionId, tasks]);

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
    takeAgentContext: () => {
      const context = pendingAgentContextRef.current;
      pendingAgentContextRef.current = null;
      return context;
    },
    cancel: cancelRun,
  };
}
