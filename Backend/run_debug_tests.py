import os
import subprocess
import sys

sys.path.append(os.getcwd())


def run(cmd):
    with open("debug_output.txt", "a") as f:
        f.write(f"--- Running: {cmd} ---\n")
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
        f.write(f"STDOUT:\n{result.stdout}\n")
        f.write(f"STDERR:\n{result.stderr}\n")


if __name__ == "__main__":
    if os.path.exists("debug_output.txt"):
        os.remove("debug_output.txt")
    run("py manage.py test leaves.tests.test_manager_workflow")
    run("py manage.py test leaves.tests.test_existing")
