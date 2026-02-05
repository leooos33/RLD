---
name: worktree
description: Manage git worktrees for isolated experimental work, refactoring, and safe parallel development
---

# Git Worktree Management Skill

Use git worktrees to create isolated working directories for experimental changes without affecting the main working tree. This enables safe refactoring, dependency cleanup, and parallel development.

## When to Use Worktrees

- **Dependency cleanup/optimization** - Remove or restructure dependencies safely
- **Large refactoring** - Make breaking changes without affecting the main branch
- **Parallel feature development** - Work on multiple features simultaneously
- **Code experiments** - Try risky changes with easy rollback

## Creating a Worktree

```bash
# From the main repo directory
cd /path/to/main-repo

# Create a new branch and worktree in one command
git worktree add /path/to/worktree-dir branch-name

# Example: Create cleanup worktree
git worktree add /home/ubuntu/RLD-cleanup cleanup/deps
```

**Naming conventions:**

- Worktree directory: `{repo}-{purpose}` (e.g., `RLD-cleanup`, `RLD-feature-x`)
- Branch name: `{category}/{description}` (e.g., `cleanup/deps`, `refactor/broker`)

## Working in a Worktree

1. **Navigate to the worktree:**

   ```bash
   cd /path/to/worktree-dir
   ```

2. **Make changes and commit:**

   ```bash
   # Stage all changes
   git add -A

   # Commit with descriptive message
   git commit -m "chore: description of changes"
   ```

3. **Verify changes work:**
   ```bash
   # Build/test in the worktree
   forge build --skip test
   ./scripts/orchestrator.sh
   ```

## Merging Back to Main Branch

1. **From the main repo directory:**

   ```bash
   cd /path/to/main-repo

   # Stash any local changes
   git stash push -m "pre-merge stash"

   # Merge the worktree branch
   git merge branch-name -m "Merge branch-name: description"
   ```

2. **Push to remote:**
   ```bash
   git push origin main-branch
   ```

## Undoing Changes in a Worktree

```bash
# Discard all uncommitted changes
git checkout HEAD -- .

# Or reset specific files
git checkout HEAD -- path/to/file

# Hard reset to original state
git reset --hard origin/branch-name
```

## Cleaning Up Worktrees

```bash
# List all worktrees
git worktree list

# Remove a worktree (from main repo)
git worktree remove /path/to/worktree-dir

# Force remove if dirty
git worktree remove --force /path/to/worktree-dir

# Delete the branch if no longer needed
git branch -d branch-name
```

## Best Practices

1. **Commit frequently** in the worktree to create restore points
2. **Test before merging** - run full verification in the worktree
3. **Use descriptive branch names** - makes `git worktree list` output readable
4. **Clean up** - remove worktrees after merging to avoid confusion
5. **Don't modify .git** - worktrees share the same .git directory

## Example: Dependency Cleanup Workflow

```bash
# 1. Create worktree
git worktree add /home/ubuntu/RLD-cleanup cleanup/deps

# 2. Work in worktree
cd /home/ubuntu/RLD-cleanup

# 3. Make and verify changes
# ... remove unused deps, optimize, etc ...
forge build --skip test
./scripts/orchestrator.sh

# 4. Commit
git add -A
git commit -m "chore: optimize dependencies"

# 5. Merge from main repo
cd /home/ubuntu/RLD
git stash
git merge cleanup/deps -m "Merge cleanup/deps: optimize dependencies"
git push origin twamm-wip

# 6. Cleanup
git worktree remove /home/ubuntu/RLD-cleanup
git branch -d cleanup/deps
```

## Troubleshooting

**"fatal: branch already checked out"**

- A branch can only be checked out in one worktree at a time
- Solution: Create a new branch or switch branches in the other worktree

**Submodule issues after merge**

- Worktrees share .git but submodule working trees may differ
- Solution: Run `git submodule update --recursive` or manually sync files

**Large commits taking long time**

- Git needs to hash many file changes
- Solution: Be patient, or split into smaller commits
