import os
import subprocess
import sys

def verify_worktree(worktree_path: str, expected_branch: str) -> None:
    """
    Deterministically verifies that the worktree at `worktree_path` exists
    and is currently on the `expected_branch`.
    """
    assert os.path.exists(worktree_path), f"Failure: Worktree directory does not exist: {worktree_path}"
    assert os.path.isdir(worktree_path), f"Failure: Worktree path is not a directory: {worktree_path}"
    
    # Check git status
    try:
        result = subprocess.run(
            ["git", "branch", "--show-current"],
            cwd=worktree_path,
            capture_output=True,
            text=True,
            check=True
        )
        actual_branch = result.stdout.strip()
        assert actual_branch == expected_branch, (
            f"Failure: Worktree on wrong branch. Expected '{expected_branch}', got '{actual_branch}'"
        )
    except subprocess.CalledProcessError as e:
        raise AssertionError(f"Failure: Not a valid git repository or command failed: {e.stderr}")
        
    print(f"PASS: Worktree at {worktree_path} is correctly isolated on branch {expected_branch}.")

if __name__ == "__main__":
    # The Poka-Yoke Verification
    # Asserting the happy path works
    TARGET_DIR = "/home/ubuntu/RLD-contracts"
    TARGET_BRANCH = "optimization/contracts"
    
    verify_worktree(TARGET_DIR, TARGET_BRANCH)
    
    # Failure Mode check (asserting failure is caught safely if we point at a bad path)
    BAD_DIR = "/home/ubuntu/NON_EXISTENT_WORKTREE"
    try:
        verify_worktree(BAD_DIR, TARGET_BRANCH)
        print("FAIL: The verifier failed to catch the bad directory.")
        sys.exit(1)
    except AssertionError as e:
        print(f"PASS: Verifier successfully caught failure mode: {e}")
