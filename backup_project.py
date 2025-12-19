import subprocess
import datetime
import os
import sys

def run_command(command):
    print(f"Executing: {command}")
    try:
        # shell=True is needed for some windows commands, but git is an executable.
        # using list of args is safer generally but for simple commands shell=True is convenient.
        result = subprocess.run(command, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, shell=True)
        if result.stdout:
            print(result.stdout)
        return True
    except subprocess.CalledProcessError as e:
        print(f"Error executing command: {command}")
        print(e.stderr)
        return False

def backup_project():
    print("="*30)
    print("   Project Backup Script")
    print("="*30)

    # Check if git is initialized
    if not os.path.exists('.git'):
        print("Error: This directory is not a git repository.")
        input("Press Enter to exit...")
        return

    # Get current timestamp
    now = datetime.datetime.now()
    timestamp = now.strftime("%Y-%m-%d-%H-%M")
    branch_name = f"backup/{timestamp}"
    commit_message = f"Auto backup at {now.strftime('%Y-%m-%d %H:%M')}"

    print(f"Target Branch: {branch_name}")

    # 1. Create and checkout new branch
    # We use checkout -b to create and switch
    if not run_command(f"git checkout -b {branch_name}"):
        print("Failed to create new branch. You might have uncommitted changes that conflict or the branch already exists.")
        # Optional: try to force or just exit. For safety, exit.
        input("Press Enter to exit...")
        return

    # 2. Add all files
    if not run_command("git add ."):
        print("Failed to add files.")
        input("Press Enter to exit...")
        return
    
    # 3. Commit
    # Check if there are changes to commit first? 
    # git commit will fail if nothing to commit.
    print("Committing changes...")
    try:
        result = subprocess.run(f'git commit -m "{commit_message}"', stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, shell=True)
        if result.returncode == 0:
            print(result.stdout)
            print("\n" + "="*30)
            print("   Backup SUCCESSFUL!")
            print("="*30)
        else:
            if "nothing to commit" in result.stdout.lower():
                print("No changes to commit. Branch created successfully.")
                print("\n" + "="*30)
                print("   Backup SUCCESSFUL (No changes)!")
                print("="*30)
            else:
                print("Commit failed:")
                print(result.stderr)
                print(result.stdout)
    except Exception as e:
        print(f"An error occurred during commit: {e}")

if __name__ == "__main__":
    backup_project()
    print("\n")
    input("Press Enter to exit...")
