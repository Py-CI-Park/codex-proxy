# Repository Guide

## Role & Intent

This repository is a local Codex Proxy fork. Keep the fork easy to update from the canonical upstream while preserving local Windows/runtime fixes.

## Remotes

- `origin`: personal fork, currently `https://github.com/Py-CI-Park/codex-proxy.git`.
- `upstream`: canonical source, `https://github.com/icebear0828/codex-proxy.git`.
- Do not push directly to `upstream`. Push local integration commits to `origin`.

## Upstream Sync Routine

Default policy: **stable-first, local-preserving**.

When the user asks to "update from upstream", "apply the latest upstream", or similar:

1. Fetch `origin` and `upstream` with tags and pruning.
2. Compare `HEAD` against `upstream/master`.
3. Summarize upstream commits, local-only commits, and likely risk before merging.
4. Preserve local fork behavior unless upstream clearly supersedes it.
5. Merge `upstream/master` by default.
6. Do not adopt `dev`, beta tags, or prerelease branches unless the user explicitly asks for prerelease updates.
7. Do not push to `upstream`.
8. Do not commit secrets or local runtime artifacts.
9. Run dependency install, build, tests, and runtime smoke checks before declaring completion.
10. Commit verified integration changes with a Lore-style commit and push only to `origin`.

Use the helper script for repeatable sync checks:

```powershell
# Preview only; safe default.
.\scripts\sync-upstream.ps1

# Merge stable upstream/master, install dependencies, build, and test.
.\scripts\sync-upstream.ps1 -Apply

# Also push the verified result to the personal fork.
.\scripts\sync-upstream.ps1 -Apply -PushOrigin
```

Preferred merge-based routine for this personal fork:

```powershell
git fetch upstream --tags --prune
git checkout master
git merge upstream/master
npm install
cd web
npm install
cd ..
npm run build
npm test
git push origin master
```

Use rebase only when intentionally rewriting the personal fork history:

```powershell
git fetch upstream --tags --prune
git checkout master
git rebase upstream/master
npm install
cd web
npm install
cd ..
npm run build
npm test
git push --force-with-lease origin master
```

Rebase/force-push rule:

- Use merge by default.
- Use rebase only when the user explicitly asks to rewrite the personal fork history.
- Never force-push without explicit user instruction.
- Stop and report before adopting prerelease targets unless the user's request explicitly includes beta/dev/prerelease.

## Local Runtime Files

Do not commit local runtime/session artifacts:

- `.omx/`
- `.env`
- `data/`
- `*.log`
- `node_modules/`
- `public/`
- `dist/`

Keep `.omx/` in `.git/info/exclude` or another local-only ignore surface unless the project intentionally decides to version OMX artifacts.

## Windows Notes

- This fork is used on Windows/PowerShell.
- Keep tests path-separator tolerant where mocked paths may be normalized by Node on Windows.
- Default local runtime port is `8081` when using this workstation's `.env`.

## GPT Model Notes

- `gpt-5.5` is supported by the upstream model catalog and runtime model endpoint.
- The upstream default remains `gpt-5.4` unless deliberately changed in `config/default.yaml` and schema defaults.
- Do not change the default model solely because a newer model exists; verify upstream intent and runtime availability first.

## Verification

Before declaring update work complete, run and read output from:

```powershell
npm run build
npm test
```

For runtime verification, start the proxy and check:

```powershell
Invoke-RestMethod -Method Get -Uri "http://localhost:8081/v1/models"
```

Confirm `gpt-5.5` is present when model-catalog work is involved.

## Commit Protocol

Use Lore-style commit messages: the first line should explain why the change exists, followed by context and useful git trailers.

For commits authored in this personal fork, write the intent line, body, and trailer values in Korean by default. Keep imported upstream commits unchanged.

Helpful trailers:

```text
Constraint: <external constraint that shaped the decision>
Rejected: <alternative> | <reason>
Confidence: <low|medium|high>
Scope-risk: <narrow|moderate|broad>
Directive: <future warning or instruction>
Tested: <commands/evidence>
Not-tested: <known gaps>
```
