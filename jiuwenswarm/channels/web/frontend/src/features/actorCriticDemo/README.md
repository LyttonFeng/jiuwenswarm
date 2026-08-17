# Swarm Reward Coding Demo

The demo has two deliberately separate user surfaces:

- `/chat/new?mode=swarm-reward` is the usable Coding Agent. It reuses JiuwenSwarm's
  `ChatPanel`, message timeline, tool cards, project picker, model selector, and
  composer. A thin controller translates the remote RewardPack pipeline into
  ordinary JiuwenSwarm user, assistant, and tool events. Explanatory follow-up
  questions are answered by the real JiuwenSwarm Agent with a bounded read-only
  projection of the selected run; the user's visible bubble remains unchanged.
- `/swarm-reward` is the experiment dashboard. It inspects a run but does not
  pretend to be an Agent conversation.

Each turn first passes through a small, non-reasoning semantic router:

- Demo control/status intent stays in the Swarm Reward controller. The model only
  classifies the turn; deterministic code owns process start, cancellation, and
  evidence projection.
- Routing is atomic and fail-closed: only an explicit `general` result falls
  through to the normal Agent. An unavailable Demo service cannot silently turn
  a RewardPack query into repository tool execution.
- Query intents are side-effect free. Only explicit start, build, and cancel
  intents may change remote execution state.
- Everything else falls through unchanged to JiuwenSwarm's normal Agent path.

The Demo controller supports composable execution semantics without command syntax:

- `演示 <task-id>` replays an already frozen, officially graded run. The UI labels
  it as replay and does not claim that a new model sample occurred.
- `请解决 <task-id>` starts a new remote sandbox run and polls real pipeline state.
- `构建 <task-id> 的 RewardPack` runs Builder and sandbox admission only. The chat
  shows each completed Builder round, then renders Goal, Solution, criteria, and
  admitted probes from the frozen Pack.
- `RewardPack 构建好了吗？` only reports the latest certified Pack. `构建好了就跑`
  explicitly starts Actor-Critic from a content-hash-verified copy; Builder is skipped.

If `请解决` is sent when a certified Pack already exists, the same reuse path is
used. The browser never chooses a server path or trusts a client-supplied Pack ID;
the service resolves and validates the latest same-task Pack.

This frozen-Pack path is the default demo path: it avoids a long live Builder run
while preserving the real Actor-Critic sandbox execution, saved turn history,
patch, and official grader result. `rebuild_fresh` and
`rebuild_with_successful_witness` remain explicit research/reproduction modes.

The research model keeps Transition and Value as separate mathematical roles. The
runtime evaluates both roles in one structured Transition-Value request so the two
candidates share one context and one network round trip. Environment replay and
deterministic veto remain separate authorities and always override model estimates.

The selected task is retained across turns, so natural follow-ups such as
`RewardPack 好了吗？` or `那就开始吧` need not repeat the task ID. After either
execution path, follow-up messages can inspect the patch, Critic intervention,
official score, or open the corresponding dashboard run. Builder rounds, Actor tool
actions, Critic interventions, and grader results appear as normal JiuwenSwarm tool
events. When construction uses a successful witness, that fact is recorded in the
Pack boundary; the witness is never exposed to Actor or online Critic.

Opening a URL with `run=<run-id>` loads that run as Q&A context without dumping the
whole saved trajectory into chat. The user can ask a real follow-up immediately;
the full turn history is expanded only after an explicit replay request.

The separation keeps the research claim legible: conversation is the intervention
surface, while the dashboard is evidence inspection.
