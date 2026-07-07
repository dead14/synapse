import sys
from engine import core
import io

# Ensure stdout is unbuffered and uses UTF-8 so Node.js gets real-time logs without Unicode errors
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', line_buffering=True)
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', line_buffering=True)

def mock_input(prompt):
    # Print the prompt to stdout so Node.js knows we are asking for something,
    # but normally we just want to feed it directly from stdin.
    line = sys.stdin.readline().strip()
    return line

# Patch the input function inside engine.core
core.input = mock_input

if __name__ == "__main__":
    core.main()
