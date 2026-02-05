---
description: Create a worktree for isolated experimental work
---

# Create Worktree Workflow

// turbo-all

Use this workflow when you need to make experimental changes in isolation.

## Steps

1. Create the worktree and branch:

```bash
git worktree add /home/ubuntu/RLD-{purpose} {category}/{branch-name}
```

2. Navigate to the worktree:

```bash
cd /home/ubuntu/RLD-{purpose}
```

3. Make your changes and verify:

```bash
# After changes...
forge build --skip test
./scripts/orchestrator.sh
```

4. Commit changes:

```bash
git add -A
git commit -m "chore: description"
```

5. Merge back (from main repo):

```bash
cd /home/ubuntu/RLD
git stash
git merge {category}/{branch-name} -m "Merge: description"
git push origin {target-branch}
```

6. Cleanup:

```bash
git worktree remove /home/ubuntu/RLD-{purpose}
git branch -d {category}/{branch-name}
```
