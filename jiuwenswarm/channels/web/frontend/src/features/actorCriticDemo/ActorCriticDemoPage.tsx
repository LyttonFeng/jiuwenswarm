import { useEffect, useMemo, useState } from 'react';
import {
  Bot,
  Boxes,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleStop,
  Code2,
  DatabaseZap,
  FileCode2,
  FlaskConical,
  FolderGit2,
  Gauge,
  LoaderCircle,
  MessageCircle,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  Wrench,
  XCircle,
} from 'lucide-react';
import {
  cancelRewardRun,
  checkRewardService,
  loadRewardRun,
  loadRewardTasks,
  loadRecentRuns,
  startRewardRun,
} from './api';
import type { RewardRun, RewardRuntimeInfo, RewardTaskPreset, PackMode } from './types';
import './ActorCriticDemoPage.css';

const STAGES = [
  { key: 'workspace', label: '载入工作区', icon: FolderGit2 },
  { key: 'rewardpack', label: '构建验收标准', icon: DatabaseZap },
  { key: 'actor', label: 'Actor-Critic 修复', icon: Bot },
  { key: 'grader', label: '官方评分', icon: FlaskConical },
  { key: 'complete', label: '完成', icon: CheckCircle2 },
] as const;

const PACK_MODE_LABELS: Record<PackMode, { title: string; description: string }> = {
  rebuild_fresh: {
    title: '现场全新构建 Pack',
    description: '从任务、Repo 与沙箱证据重新构建；适合研究复现，现场耗时较长。',
  },
  rebuild_with_successful_witness: {
    title: '使用成功 witness 重建 Pack',
    description: 'Builder 使用成功 witness 提高构建稳定性；Actor 与 Critic 不可见 witness。',
  },
};

function formatTime(epoch?: number): string {
  if (!epoch) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(epoch * 1000));
}

function elapsed(run: RewardRun | null): string {
  if (!run) return '—';
  const end = run.finished_at || Date.now() / 1000;
  const seconds = Math.max(0, Math.round(end - run.created_at));
  const minutes = Math.floor(seconds / 60);
  return `${minutes} 分 ${String(seconds % 60).padStart(2, '0')} 秒`;
}

function shortCommit(value: string): string {
  return value.slice(0, 10);
}

function preferredPackMode(task?: RewardTaskPreset): PackMode {
  if (task?.available_pack_modes.includes('rebuild_with_successful_witness')) {
    return 'rebuild_with_successful_witness';
  }
  return task?.available_pack_modes[0] || 'rebuild_fresh';
}

export default function ActorCriticDemoPage() {
  const [connection, setConnection] = useState<'checking' | 'online' | 'offline'>('checking');
  const [tasks, setTasks] = useState<RewardTaskPreset[]>([]);
  const [runtime, setRuntime] = useState<RewardRuntimeInfo | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [packMode, setPackMode] = useState<PackMode>('rebuild_with_successful_witness');
  const [run, setRun] = useState<RewardRun | null>(null);
  const [recentRuns, setRecentRuns] = useState<RewardRun[]>([]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [showTechnical, setShowTechnical] = useState(false);

  const selectedTask = useMemo(
    () => tasks.find((task) => task.task_id === selectedTaskId) || tasks[0],
    [selectedTaskId, tasks],
  );

  useEffect(() => {
    let active = true;
    async function bootstrap() {
      try {
        await checkRewardService();
        const requestedRunId = new URLSearchParams(window.location.search).get('run');
        const [catalog, recent, requestedRun] = await Promise.all([
          loadRewardTasks(),
          loadRecentRuns(),
          requestedRunId ? loadRewardRun(requestedRunId).catch(() => null) : Promise.resolve(null),
        ]);
        if (!active) return;
        setTasks(catalog.tasks);
        setRuntime(catalog.runtime);
        setSelectedTaskId(requestedRun?.task.task_id || catalog.tasks[0]?.task_id || '');
        setPackMode(requestedRun?.pack_mode || preferredPackMode(catalog.tasks[0]));
        setRun(requestedRun);
        setRecentRuns(recent);
        setConnection('online');
      } catch (reason) {
        if (!active) return;
        setConnection('offline');
        setError(reason instanceof Error ? reason.message : '无法连接 Swarm Reward 服务');
      }
    }
    void bootstrap();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedTask) return;
    if (!selectedTask.available_pack_modes.includes(packMode)) {
      setPackMode(preferredPackMode(selectedTask));
    }
  }, [packMode, selectedTask]);

  useEffect(() => {
    if (!run || ['completed', 'failed', 'cancelled'].includes(run.status)) return;
    const timer = window.setInterval(() => {
      void loadRewardRun(run.run_id)
        .then((next) => {
          setRun(next);
          setError('');
        })
        .catch((reason) => {
          setError(reason instanceof Error ? reason.message : '刷新运行状态失败');
        });
    }, 1500);
    return () => window.clearInterval(timer);
  }, [run?.run_id, run?.status]);

  async function handleStart() {
    if (!selectedTask) return;
    setStarting(true);
    setError('');
    try {
      const next = await startRewardRun(selectedTask.task_id, packMode);
      setRun(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '任务启动失败');
    } finally {
      setStarting(false);
    }
  }

  async function handleCancel() {
    if (!run) return;
    try {
      setRun(await cancelRewardRun(run.run_id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '停止任务失败');
    }
  }

  async function reconnect() {
    setConnection('checking');
    setError('');
    try {
      await checkRewardService();
      const catalog = await loadRewardTasks();
      setTasks(catalog.tasks);
      setRuntime(catalog.runtime);
      setSelectedTaskId((current) => current || catalog.tasks[0]?.task_id || '');
      setPackMode((current) => (
        catalog.tasks[0]?.available_pack_modes.includes(current)
          ? current
          : preferredPackMode(catalog.tasks[0])
      ));
      setRecentRuns(await loadRecentRuns());
      setConnection('online');
    } catch (reason) {
      setConnection('offline');
      setError(reason instanceof Error ? reason.message : '无法连接 Swarm Reward 服务');
    }
  }

  const phaseIndex = run?.phase_index ?? -1;
  const running = run?.status === 'queued' || run?.status === 'running';
  const resolved = Boolean(run?.grader.complete && run.grader.resolved === 1);

  return (
    <div className="swarm-reward">
      <aside className="swarm-reward__rail" aria-label="JiuwenSwarm 导航">
        <div className="swarm-reward__brand" aria-label="JiuwenSwarm">J</div>
        <button className="swarm-reward__rail-item" type="button" title="任务">
          <TerminalSquare aria-hidden="true" />
          <span>任务</span>
        </button>
        <button className="swarm-reward__rail-item" type="button" title="技能">
          <Sparkles aria-hidden="true" />
          <span>技能</span>
        </button>
        <button className="swarm-reward__rail-item swarm-reward__rail-item--active" type="button" title="Swarm Reward">
          <ShieldCheck aria-hidden="true" />
          <span>Reward</span>
        </button>
        <div className="swarm-reward__rail-spacer" />
        <div className={`swarm-reward__connection swarm-reward__connection--${connection}`} title="远端沙箱连接状态" />
      </aside>

      <aside className="swarm-reward__sidebar">
        <div className="swarm-reward__sidebar-title">
          <span>Swarm Reward</span>
          <ChevronDown size={16} aria-hidden="true" />
        </div>
        <button className="swarm-reward__new-run" type="button" onClick={() => setRun(null)}>
          <Play size={16} aria-hidden="true" />
          新建修复任务
        </button>

        <div className="swarm-reward__sidebar-label">任务预置</div>
        <div className="swarm-reward__task-list">
          {tasks.map((task) => (
            <button
              key={task.task_id}
              className={`swarm-reward__task ${task.task_id === selectedTask?.task_id ? 'is-active' : ''}`}
              type="button"
              onClick={() => setSelectedTaskId(task.task_id)}
              title={task.title}
            >
              <FolderGit2 size={16} aria-hidden="true" />
              <span>{task.title}</span>
            </button>
          ))}
        </div>

        {recentRuns.length > 0 ? (
          <>
            <div className="swarm-reward__sidebar-label">最近运行</div>
            <div className="swarm-reward__recent-list">
              {recentRuns.slice(0, 5).map((item) => (
                <button key={item.run_id} type="button" onClick={() => { setRun(item); setPackMode(item.pack_mode); }}>
                  <span className={`swarm-reward__recent-dot is-${item.status}`} />
                  <span>
                    <b>{item.task.task_id}</b>
                    <small>{formatTime(item.created_at)} · {item.status}</small>
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : null}

        <div className="swarm-reward__sidebar-bottom">
          <div className="swarm-reward__host-status">
            <Boxes size={17} aria-hidden="true" />
            <span>
              <b>{connection === 'online' ? '182 沙箱在线' : '沙箱未连接'}</b>
              <small>{runtime?.execution || '等待服务连接'}</small>
            </span>
          </div>
        </div>
      </aside>

      <main className="swarm-reward__main">
        <header className="swarm-reward__topbar">
          <div>
            <div className="swarm-reward__eyebrow">JIUWENSWARM × SWARM REWARD</div>
            <h1>自进化 Coding 工作台</h1>
          </div>
          <div className="swarm-reward__top-actions">
            <a className="swarm-reward__chat-link" href="/chat/new?mode=swarm-reward">
              <MessageCircle size={17} aria-hidden="true" />
              打开对话 Agent
            </a>
            <span className={`swarm-reward__live-status is-${connection}`}>
              <span />{connection === 'online' ? '真实执行环境已连接' : connection === 'checking' ? '正在连接' : '执行环境离线'}
            </span>
            <button type="button" className="swarm-reward__icon-button" onClick={() => void reconnect()} title="重新连接">
              <RefreshCw size={17} aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="swarm-reward__content">
          {connection === 'offline' ? (
            <section className="swarm-reward__offline" role="alert">
              <XCircle size={34} aria-hidden="true" />
              <h2>182 coding 服务尚未连接</h2>
              <p>网页没有进入模拟模式。启动远端服务和 SSH 端口转发后，再重新连接。</p>
              <button type="button" onClick={() => void reconnect()}><RefreshCw size={16} />重新连接</button>
            </section>
          ) : (
            <>
              <section className="swarm-reward__task-header">
                <div className="swarm-reward__task-copy">
                  <div className="swarm-reward__badges">
                    <span>{selectedTask?.repo_slug || '载入任务中'}</span>
                    <span>base {selectedTask ? shortCommit(selectedTask.base_commit) : '—'}</span>
                    <span className={packMode === 'rebuild_with_successful_witness' ? 'is-witness-assisted' : 'is-fresh'}>
                      {packMode === 'rebuild_with_successful_witness' ? '成功 witness 仅用于构建' : 'Fresh construction'}
                    </span>
                  </div>
                  <h2>{selectedTask?.title || '正在从远端载入任务'}</h2>
                  <p>{selectedTask?.issue}</p>
                </div>
                <div className="swarm-reward__result-card">
                  <span>当前结果</span>
                  <strong className={resolved ? 'is-resolved' : run?.status === 'failed' ? 'is-failed' : ''}>
                    {resolved ? '1 / 1 Resolved' : run?.status === 'failed' ? '运行失败' : running ? '正在求解' : '等待启动'}
                  </strong>
                  <small>{run ? `${run.actor.tool_calls} 次工具调用 · ${run.actor.interventions} 次 Critic 介入` : '尚未执行任何模型调用'}</small>
                </div>
              </section>

              <section className="swarm-reward__launch">
                <div className="swarm-reward__launch-copy">
                  <ShieldCheck size={22} aria-hidden="true" />
                  <div>
                    <b>RewardPack 模式</b>
                    <span>{PACK_MODE_LABELS[packMode].description}</span>
                    <span>领导现场演示优先从对话 Agent 复用已认证的冻结 Pack；这里保留完整重建入口。</span>
                  </div>
                </div>
                <label className="swarm-reward__mode-select">
                  <span className="sr-only">RewardPack 模式</span>
                  <select value={packMode} onChange={(event) => setPackMode(event.target.value as PackMode)} disabled={running}>
                    {(selectedTask?.available_pack_modes || []).map((mode) => (
                      <option key={mode} value={mode}>{PACK_MODE_LABELS[mode].title}</option>
                    ))}
                  </select>
                  <ChevronDown size={15} aria-hidden="true" />
                </label>
                {running ? (
                  <button className="swarm-reward__stop-button" type="button" onClick={() => void handleCancel()}>
                    <CircleStop size={17} />停止
                  </button>
                ) : (
                  <button className="swarm-reward__start-button" type="button" onClick={() => void handleStart()} disabled={!selectedTask || starting || connection !== 'online'}>
                    {starting ? <LoaderCircle className="is-spinning" size={17} /> : <Play size={17} fill="currentColor" />}
                    载入工作区并开始修复
                  </button>
                )}
              </section>

              {error ? <div className="swarm-reward__error" role="alert">{error}</div> : null}

              <section className="swarm-reward__stages" aria-label="执行阶段">
                {STAGES.map((stage, index) => {
                  const StageIcon = stage.icon;
                  const done = phaseIndex > index || (run?.status === 'completed' && index === STAGES.length - 1);
                  const active = phaseIndex === index;
                  return (
                    <div key={stage.key} className={`swarm-reward__stage ${done ? 'is-done' : ''} ${active ? 'is-active' : ''}`}>
                      <div className="swarm-reward__stage-icon">
                        {done ? <Check size={16} /> : active && running ? <LoaderCircle className="is-spinning" size={16} /> : <StageIcon size={16} />}
                      </div>
                      <span>{stage.label}</span>
                      {index < STAGES.length - 1 ? <i /> : null}
                    </div>
                  );
                })}
              </section>

              <div className="swarm-reward__workspace-grid">
                <section className="swarm-reward__activity-panel">
                  <div className="swarm-reward__panel-heading">
                    <div>
                      <h3>实时执行轨迹</h3>
                      <p>{run?.message || '点击“载入工作区并开始修复”后，这里显示真实运行状态。'}</p>
                    </div>
                    {run ? <span className="swarm-reward__run-id">{run.run_id}</span> : null}
                  </div>

                  <div className="swarm-reward__timeline">
                    <TimelineItem
                      icon={FolderGit2}
                      title="代码工作区"
                      state={run?.workspace_path ? 'done' : running ? 'running' : 'waiting'}
                      detail={run?.workspace_path || '等待从冻结 SWE 镜像载入 /testbed'}
                    />
                    <TimelineItem
                      icon={DatabaseZap}
                      title="RewardPack"
                      state={run?.rewardpack.verified ? 'done' : run?.phase === 'rewardpack' ? 'running' : 'waiting'}
                      detail={run?.rewardpack.verified ? `${run.rewardpack.passed}/${run.rewardpack.probe_count} 个 probe 经沙箱认证并冻结${run.rewardpack.rewardpack_id ? `；Pack ${run.rewardpack.rewardpack_id}` : ''}${run.rewardpack.construction.successful_witness_used ? '；成功 witness 仅用于 Builder，Actor/Critic 不可见' : '；fresh construction'}${run.rewardpack.boundary.hidden_tests_used ? '；使用了 hidden tests' : '；未使用 hidden tests'}` : '等待构建或载入冻结 RewardPack'}
                    />
                    <TimelineItem
                      icon={Bot}
                      title="Jiuwen Actor"
                      state={run?.actor.completed ? 'done' : run?.actor.started ? 'running' : 'waiting'}
                      detail={run?.actor.started ? `${run.actor.tool_calls} 次工具调用；${run.actor.turns_reviewed} 个 pending action 已审阅${run.actor.critic_errors ? `；${run.actor.critic_errors} 次 Critic 异常` : ''}` : '等待 Actor 在真实 Repo 中读代码、编辑并测试'}
                    />
                    {run?.actor.latest_hint ? (
                      <div className="swarm-reward__critic-card">
                        <div className="swarm-reward__critic-card-head">
                          <span><ShieldCheck size={17} />Critic 介入</span>
                          <b>{Math.round((run.actor.latest_confidence || 0) * 100)}% 置信度</b>
                        </div>
                        <p>{run.actor.latest_hint}</p>
                        <small>只注入当前 fresh hint；reasoning 不进入 Actor 历史。</small>
                      </div>
                    ) : null}
                    <TimelineItem
                      icon={FlaskConical}
                      title="官方 Docker grader"
                      state={run?.grader.complete ? (resolved ? 'done' : 'failed') : run?.phase === 'grader' ? 'running' : 'waiting'}
                      detail={run?.grader.complete ? `${run.grader.resolved} resolved · ${run.grader.unresolved} unresolved · ${run.grader.errors} error` : '等待 patch 产生后执行官方评分'}
                    />
                  </div>
                </section>

                <aside className="swarm-reward__evidence-panel">
                  <div className="swarm-reward__panel-heading">
                    <div>
                      <h3>运行证据</h3>
                      <p>只显示可见动作与执行结果</p>
                    </div>
                    <Gauge size={19} aria-hidden="true" />
                  </div>
                  <div className="swarm-reward__metric-grid">
                    <Metric label="Pack probes" value={run ? `${run.rewardpack.passed}/${run.rewardpack.probe_count}` : '—'} positive={Boolean(run?.rewardpack.verified)} />
                    <Metric label="Actor 工具" value={run ? String(run.actor.tool_calls) : '—'} />
                    <Metric label="Critic 介入" value={run ? String(run.actor.interventions) : '—'} />
                    <Metric label="Grader" value={run?.grader.complete ? `${run.grader.resolved}/1` : '—'} positive={resolved} />
                  </div>
                  <dl className="swarm-reward__facts">
                    <div><dt>Actor</dt><dd>{runtime?.actor_model || '—'}</dd></div>
                    <div><dt>Builder</dt><dd>{runtime?.builder_model || '—'}</dd></div>
                    <div><dt>Critic</dt><dd>{runtime?.critic_model || '—'}</dd></div>
                    <div><dt>启动时间</dt><dd>{formatTime(run?.created_at)}</dd></div>
                    <div><dt>运行耗时</dt><dd>{elapsed(run)}</dd></div>
                  </dl>
                  <button className="swarm-reward__technical-button" type="button" onClick={() => setShowTechnical((value) => !value)} disabled={!run}>
                    <Code2 size={16} />{showTechnical ? '收起技术证据' : '展开技术证据'}<ChevronDown size={15} className={showTechnical ? 'is-open' : ''} />
                  </button>
                </aside>
              </div>

              {showTechnical && run ? (
                <div className="swarm-reward__technical-stack">
                  <section className="swarm-reward__technical">
                    <div className="swarm-reward__technical-head">
                      <div>
                        <span><Bot size={17} />Actor-Critic 完整历史</span>
                        <small>{run.timeline.length} 条已保存事件；点击任一回合展开</small>
                      </div>
                      <span className="swarm-reward__verdict">
                        {run.actor.turns_reviewed} reviews · {run.actor.interventions} speak{run.actor.critic_errors ? ` · ${run.actor.critic_errors} error` : ''}
                      </span>
                    </div>
                    <div className="swarm-reward__history">
                      {run.timeline.map((event) => (
                        <details
                          className={`swarm-reward__history-event is-${event.decision || event.stage}`}
                          key={event.id}
                          open={event.decision === 'speak'}
                        >
                          <summary>
                            <span>{event.title}</span>
                            <b>{event.decision || event.status}</b>
                          </summary>
                          <pre>{event.detail}</pre>
                          {event.metrics ? (
                            <div className="swarm-reward__history-metrics">
                              <Metric label="V(next | Actor)" value={formatMetric(event.metrics.actor_success_value)} />
                              <Metric label="V(next | Revision)" value={formatMetric(event.metrics.revision_success_value)} />
                              <Metric label="A_cf" value={formatMetric(event.metrics.counterfactual_advantage)} />
                              <Metric label="Threshold" value={formatMetric(event.metrics.intervention_threshold)} />
                            </div>
                          ) : null}
                        </details>
                      ))}
                    </div>
                  </section>
                  <section className="swarm-reward__technical">
                    <div className="swarm-reward__technical-head">
                      <div>
                        <span><FileCode2 size={17} />真实工作树补丁</span>
                        <small>{run.patch.available ? `${run.patch.bytes || run.patch.preview.length} bytes` : '尚未产生 patch'}</small>
                      </div>
                      <span className={`swarm-reward__verdict ${resolved ? 'is-resolved' : ''}`}>
                        {run.grader.complete ? `${run.grader.resolved}/1 resolved` : 'grader pending'}
                      </span>
                    </div>
                    <pre>{run.patch.preview || 'Actor 尚未形成可交付补丁。'}</pre>
                  </section>
                </div>
              ) : null}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function TimelineItem({
  icon: Icon,
  title,
  detail,
  state,
}: {
  icon: typeof Wrench;
  title: string;
  detail: string;
  state: 'waiting' | 'running' | 'done' | 'failed';
}) {
  return (
    <div className={`swarm-reward__timeline-item is-${state}`}>
      <div className="swarm-reward__timeline-icon">
        {state === 'running' ? <LoaderCircle className="is-spinning" size={17} /> : state === 'done' ? <Check size={17} /> : state === 'failed' ? <XCircle size={17} /> : <Icon size={17} />}
      </div>
      <div><b>{title}</b><p>{detail}</p></div>
    </div>
  );
}

function Metric({ label, value, positive = false }: { label: string; value: string; positive?: boolean }) {
  return (
    <div className={`swarm-reward__metric ${positive ? 'is-positive' : ''}`}>
      <span>{label}</span><b>{value}</b>
    </div>
  );
}

function formatMetric(value: number | null): string {
  return value === null ? '—' : value.toFixed(3);
}
