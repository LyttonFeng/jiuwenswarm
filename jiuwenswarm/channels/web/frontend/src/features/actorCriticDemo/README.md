# Swarm Reward Coding Demo

The demo has two deliberately separate user surfaces:

- `/chat/new?mode=swarm-reward` is the usable Coding Agent. It reuses JiuwenSwarm's
  `ChatPanel`, message timeline, tool cards, project picker, model selector, and
  composer. A thin controller translates the remote RewardPack pipeline into
  ordinary JiuwenSwarm user, assistant, and tool events.
- `/swarm-reward` is the experiment dashboard. It inspects a run but does not
  pretend to be an Agent conversation.

The chat accepts two explicit execution semantics:

- `演示 <task-id>` replays an already frozen, officially graded run. The UI labels
  it as replay and does not claim that a new model sample occurred.
- `请解决 <task-id>` starts a new remote sandbox run and polls real pipeline state.

After either path, follow-up messages can inspect the patch, Critic intervention,
official score, or open the corresponding dashboard run. Gold-assisted mode means
only the offline RewardPack Builder sees Gold; Actor and online Critic do not.

The separation keeps the research claim legible: conversation is the intervention
surface, while the dashboard is evidence inspection.
