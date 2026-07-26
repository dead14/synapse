import pandas as pd
import json
import math
import sys

def main():
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        # Load excel data
        # Skip rows 0 and 1 (which are title and grouping headers), the actual columns are on row 2
        df_comparison = pd.read_excel('../ILI_Comparison_Final.xlsx', sheet_name='Comparison', skiprows=2)
        
        # We also need GW Match offset
        df_residual = pd.read_excel('../ILI_Comparison_Final.xlsx', sheet_name='Residual_Plot', skiprows=2)
        
        # Replace NaN with None for valid JSON
        df_comparison = df_comparison.replace({float('nan'): None})
        df_residual = df_residual.replace({float('nan'): None})
        
        # Output as JSON string
        print(json.dumps({
            "comparison": df_comparison.to_dict(orient='records'),
            "residual": df_residual.to_dict(orient='records')
        }))
    except Exception as e:
        print(json.dumps({"error": str(e)}))

if __name__ == "__main__":
    main()
