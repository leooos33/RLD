
import sqlite3
import shutil
import os
import sys
import time
from datetime import datetime

# Add backend directory to sys.path to import config
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from config import DB_NAME

# --- CONFIG ---
BACKUP_ROOT = "backups"
RETENTION_DAYS = 7

# Source Files (Adjusted for Scripts Directory: backend/scripts/)
BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
ROOT_DIR = os.path.abspath(os.path.join(BACKEND_DIR, '..'))

DB_FILE = os.path.join(BACKEND_DIR, DB_NAME)
CONFIG_FILE = os.path.join(BACKEND_DIR, "config.py")
ENV_FILE = os.path.join(ROOT_DIR, ".env")
YIELDS_FILE = os.path.join(BACKEND_DIR, "yields.json")

def create_backup():
    # 1. Setup Destination
    timestamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    dest_dir = os.path.join(ROOT_DIR, BACKUP_ROOT, timestamp)
    os.makedirs(dest_dir, exist_ok=True)
    
    print(f"📦 Starting Backup to: {dest_dir}")
    
    # 2. SQLite Hot Backup (VACUUM INTO)
    # This creates a transaction-safe snapshot even if DB is busy.
    try:
        dest_db = os.path.join(dest_dir, DB_NAME)
        conn = sqlite3.connect(DB_FILE)
        print(f"   Snapshotting {DB_NAME}...")
        conn.execute(f"VACUUM INTO '{dest_db}'")
        conn.close()
        print("   ✅ Database snapshot complete.")
    except Exception as e:
        print(f"   ❌ Database snapshot failed (might be empty/locked): {e}")

    # 3. File Copies
    files_to_copy = [
        (CONFIG_FILE, "config.py"),
        (ENV_FILE, ".env"),
        (YIELDS_FILE, "yields.json")
    ]
    
    for src, name in files_to_copy:
        if os.path.exists(src):
            try:
                shutil.copy2(src, os.path.join(dest_dir, name))
                print(f"   ✅ Copied {name}")
            except Exception as e:
                print(f"   ⚠️ Failed to copy {name}: {e}")
        else:
            print(f"   ⚠️ Source not found: {name}")

    print(f"🎉 Backup Complete: {timestamp}")
    
    # 4. Cleanup / Rotation
    cleanup_old_backups()

def cleanup_old_backups():
    root = os.path.join(ROOT_DIR, BACKUP_ROOT)
    if not os.path.exists(root):
        return
        
    print("🧹 Checking for old backups...")
    
    # List all subdirectories
    backups = []
    for entry in os.scandir(root):
        if entry.is_dir():
            backups.append(entry)
    
    # Sort by name (timestamp)
    backups.sort(key=lambda x: x.name)
    
    # Retention Policy
    while len(backups) > RETENTION_DAYS:
        to_delete = backups.pop(0)
        print(f"   Deleting old backup: {to_delete.name}")
        shutil.rmtree(to_delete.path)

if __name__ == "__main__":
    create_backup()
