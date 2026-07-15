
import pandas as pd
df2024 = pd.read_excel("HU_CPA_2024.xlsx", engine="openpyxl")
df2026 = pd.read_excel("HU_CPA_2026.xlsx", engine="openpyxl")

print("Columns 2024:", list(df2024.columns))
print("Columns 2026:", list(df2026.columns))

