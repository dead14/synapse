import pandas as pd
import json
import sys

def explore_file(filepath):
    print(f"--- Exploring {filepath} ---")
    try:
        xl = pd.ExcelFile(filepath)
        print("Sheets:", xl.sheet_names)
        for sheet in xl.sheet_names:
            df = pd.read_excel(filepath, sheet_name=sheet, nrows=5)
            print(f"Sheet '{sheet}' Columns:")
            print(list(df.columns))
            print("Sample data:")
            print(df.to_json(orient='records'))
    except Exception as e:
        print("Error:", e)
    print("\n")

if __name__ == "__main__":
    explore_file(r"D:\Project PHM\Synapse\ILI_Data_2020.xlsx")
    explore_file(r"D:\Project PHM\Synapse\ILI_Data_2025.xlsx")
