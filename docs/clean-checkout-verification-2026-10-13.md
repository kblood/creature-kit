# Clean-checkout verification: 2026-10-13

Creature Kit is its own Git repository. The canonical procedural creature
composer, planetary body and pose implementation, LOD reducer, exporter and
Animal Lab app are maintained here; Universe Atlas consumes a pinned generated
copy. The Kit previously depended on Atlas's `node_modules` junction and had no
lockfile. Commit `c2203ae` declares Playwright and adds the npm lockfile so a
fresh checkout can install, build and test without Atlas dependencies.

Verification used an isolated copy under
`C:/LLM/IWSDK/Assets/_assetctl/kit-track3-clean-install-20261013/checkout`,
with no `node_modules` junction, Node v24.7.0 and npm 11.5.1:

- `npm ci`: passed, 77 packages installed, zero reported vulnerabilities.
- `npm run build`: passed.
- `npm test`: 290 passed, 0 failed, 2 Atlas parity tests skipped because
  `ATLAS_DIR` was unset.
- `npm run test:lab`: 91 passed, 0 failed, 4 Atlas parity tests skipped for
  the same reason.
- `npm run lab:build`: passed.
- Browser checks `animal-motion`, `animal-atlas-benchmark`,
  `animal-five-optimizations`, `animal-lab-lod` and `planet-lab-ui` passed.
  `animal-benchmark` passed when run alone both in the clean copy and the
  original worktree; its first clean-suite attempt was timing-sensitive and
  did not reproduce.
- `fauna-composer` failed the existing “wing limitation explained” UI check
  in both the clean copy and original worktree, with the same 60-second
  `waitForFunction` timeout. The report contained 30 screenshots and no page
  errors. This is a matching pre-existing browser acceptance failure, not an
  install or build failure.

The entire browser suite was not completed: the sequential runner was stopped
after more than five minutes without output while it was in `fauna-composer`.
The other browser cases after it were therefore not run in that invocation.
Full command output and browser reports are preserved in the ignored Atlas
review directory `Assets/_assetctl/verification-20261013-luna/` and the clean
checkout's `test-results/` directory.

Atlas's normal vendor update was also run successfully after the Kit commit;
it rebuilt and synchronized 89 files from Kit 0.11.1 at `c2203ae9524b`. Atlas
continues to consume the Kit through its pinned vendor revision.
