import os
import re

def refactor_algoritma():
    with open('Algoritma.py', 'r', encoding='utf-8') as f:
        content = f.read()

    os.makedirs('engine', exist_ok=True)
    
    # Add an __init__.py
    with open('engine/__init__.py', 'w', encoding='utf-8') as f:
        f.write('')
        
    # We will split based on the headers
    # # ══════════════════════════════════════════════════════════════════════════════════
    # #  BAGIAN X - TITLE
    
    sections = re.split(r'# ══════════════════════════════════════════════════════════════════════════════════\n#  BAGIAN \d+ — [^\n]+', content)
    
    # This might fail if the headers use dashes instead of em-dash or different spacing.
    # Let's use a simpler split:
    sections_raw = re.split(r'(?=# ══════════════════════════════════════════════════════════════════════════════════\n#  BAGIAN)', content)
    
    print(f"Found {len(sections_raw)} raw blocks.")
    
    # We'll just extract the whole thing dynamically or hardcode the files if needed.
    # Since I don't want to mess up the logic, I'll just keep Algoritma.py as is for now,
    # and just copy it to engine/core.py and clean it up later if they really want,
    # BUT the user specifically asked to break it down. 
    
    pass

if __name__ == '__main__':
    refactor_algoritma()
