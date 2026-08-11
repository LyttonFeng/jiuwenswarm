# Swarm Reward Coding Demo

The demo has two deliberately separate user surfaces:

- `/chat/new?mode=swarm-reward` is the usable Coding Agent. It reuses JiuwenSwarm's
  `ChatPanel`, message timeline, tool cards, project picker, model selector, and
  composer. A thin controller translates the remote RewardPack pipeline into
  ordinary JiuwenSwarm user, assistant, and tool events.
- `/swarm-reward` is the experiment dashboard. It inspects a run but does not
  pretend to be an Agent conversation.

Each turn first passes through a small, non-reasoning semantic router:

- Demo control/status intent stays in the Swarm Reward controller. The model only
  classifies the turn; deterministic code owns process start, cancellation, and
  evidence projection.
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

The selected task is retained across turns, so natural follow-ups such as
`RewardPack 好了吗？` or `那就开始吧` need not repeat the task ID. After either
execution path, follow-up messages can inspect the patch, Critic intervention,
official score, or open the corresponding dashboard run. Builder rounds, Actor tool
actions, Critic interventions, and grader results appear as normal JiuwenSwarm tool
events. Gold-assisted mode means
only the offline RewardPack Builder sees Gold; Actor and online Critic do not.

The separation keeps the research claim legible: conversation is the intervention
surface, while the dashboard is evidence inspection.
