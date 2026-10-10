# Current Animal Lab and preserved historical work

The primary Animal Lab is `apps/creature-lab/index.html`. It opens the advanced
Composer with the existing visual controls, multi-layout recipes, eyes, herds,
comparison and animated poses. Snakes, worms, turtles, dinosaurs and many-legged
animals belong here. Proboscis is a head/nose shape with a six-bone trunk.

The library's historical presentation remains available as `skin-5`.
`realism-1` adds joined, shaped feet and anatomy-aware foot LOD protection.
Neither changes the encoded recipe or substitutes the planetary quadruped rig.
See `composer-realism-1.md` for measured evidence and limitations.

`planet-skin.html` is labelled an archived planet inspector. Its compatibility
tools are preserved because Atlas planets still consume `./planet`. This cleanup
does not claim that Composer recipes have replaced planetary genomes.

Preserved annotated tags in this repository:

- `archive/quadruped-lab-kit06-20261011`
- `archive/composer-skin5-before-realism-20261011`

Both identify the exact pre-cleanup commit `38215a7`. No historical fixture or
asset was repinned to disguise a change. All eleven local branch copies of the
Composer mesh, rig and controls were checked; they held the same advanced source.

The completed `animal-quality-astra`, `lab-quality-release` and `lab-ui-astra`
worktrees were moved using `git worktree move` into
`C:/LLM/IWSDK/creature-kit-wt/_archive/20261011/`. Their branches and commits remain
available. Atlas's completed Lab release, production verifier and release-state
worktrees were archived the same way. The exact paths and commit audit are in
`Assets/_assetctl/composer-realism-20261011/worktree-archive.json` in IWSDK.
Active work, unrelated research, original assets and uncommitted user files were
preserved.

Review assistance: Astra 6 implemented and measured the anatomy/LOD candidate.
Claude Opus 5.5 provided a read-only anatomy and motion review; the actual model
identifier `claude-opus-5-5` is recorded in the review result. No local checkpoint,
model download or generated third-party asset was used.
