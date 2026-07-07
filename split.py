import os

def refactor():
    with open('Algoritma.py', 'r', encoding='utf-8') as f:
        lines = f.readlines()
        
    os.makedirs('engine', exist_ok=True)
    with open('engine/__init__.py', 'w', encoding='utf-8') as f:
        f.write('')
        
    # Define splits by line numbers (0-indexed)
    # 57 is start of BAGIAN 1
    # 201 is start of BAGIAN 2
    # 246 is start of BAGIAN 3
    # 389 is start of BAGIAN 4
    # 466 is start of BAGIAN 5
    # 620 is start of BAGIAN 6
    # 800 is start of BAGIAN 7
    # 883 is start of BAGIAN 8
    # 916 is start of BAGIAN 9
    # 1151 is start of BAGIAN 10
    # 1287 is start of BAGIAN 11
    # 1532 is start of BAGIAN 12
    # 2372 is start of BAGIAN 13

    header = "".join(lines[0:57])
    
    # 1. constants.py (Bagian 1)
    with open('engine/constants.py', 'w', encoding='utf-8') as f:
        f.write("import pandas as pd\nimport numpy as np\n")
        f.write("".join(lines[57:201]))
        
    # 2. loader.py (Bagian 2 & 3)
    with open('engine/loader.py', 'w', encoding='utf-8') as f:
        f.write("import pandas as pd\nimport numpy as np\nimport sys\nimport re\nfrom .constants import *\n")
        f.write("".join(lines[201:389]))
        
    # 3. math_utils.py (Bagian 4 & 5)
    with open('engine/math_utils.py', 'w', encoding='utf-8') as f:
        f.write("import pandas as pd\nimport numpy as np\nfrom .constants import *\n")
        f.write("".join(lines[389:620]))
        
    # 4. matching.py (Bagian 6, 7, 8, 9)
    with open('engine/matching.py', 'w', encoding='utf-8') as f:
        f.write("import pandas as pd\nimport numpy as np\nimport bisect\nfrom scipy.optimize import linear_sum_assignment\n")
        f.write("from .constants import *\nfrom .math_utils import *\n")
        f.write("".join(lines[620:1151]))
        
    # 5. physics.py (Bagian 10)
    with open('engine/physics.py', 'w', encoding='utf-8') as f:
        f.write("import pandas as pd\nimport numpy as np\nfrom .constants import *\n")
        f.write("".join(lines[1151:1287]))
        
    # 6. excel_writer.py (Bagian 12)
    with open('engine/excel_writer.py', 'w', encoding='utf-8') as f:
        f.write("import pandas as pd\nimport numpy as np\nfrom openpyxl import Workbook\nfrom openpyxl.styles import PatternFill, Font, Alignment, Border, Side\nfrom openpyxl.utils import get_column_letter\nfrom .constants import *\n")
        f.write("".join(lines[1532:2372]))
        
    # 7. core.py (Bagian 11 & 13)
    with open('engine/core.py', 'w', encoding='utf-8') as f:
        f.write("import pandas as pd\nimport numpy as np\nimport os\nimport sys\n")
        f.write("from .constants import *\nfrom .loader import *\nfrom .math_utils import *\nfrom .matching import *\nfrom .physics import *\nfrom .excel_writer import *\n")
        f.write("".join(lines[1287:1532])) # Bagian 11
        f.write("".join(lines[2372:])) # Bagian 13
        
    print("Split completed.")

if __name__ == '__main__':
    refactor()
