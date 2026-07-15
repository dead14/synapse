import os
import pandas as pd
from sqlalchemy import create_engine, inspect

# Konfigurasi Koneksi ke PostgreSQL
DB_URL = os.getenv('DATABASE_URL')
EXPORT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'db_exports')

def export_all_tables():
    if not DB_URL:
        raise RuntimeError('DATABASE_URL must be configured before exporting database tables')
    print("Membuka koneksi ke PostgreSQL...")
    engine = create_engine(DB_URL)
    
    # Buat folder export kalau belum ada
    if not os.path.exists(EXPORT_DIR):
        os.makedirs(EXPORT_DIR)
        
    # Inspeksi semua tabel yang ada di dalam database
    inspector = inspect(engine)
    tables = inspector.get_table_names()
    
    if not tables:
        print("Database kosong! Tidak ada tabel ditemukan.")
        return
        
    print(f"Ditemukan {len(tables)} tabel. Mulai mengekstrak data...\n")
    
    for table in tables:
        try:
            # Tarik semua data dari tabel (dibatasi 1000 baris agar tidak berat jika tabel raksasa)
            query = f'SELECT * FROM {table} LIMIT 1000'
            df = pd.read_sql(query, engine)
            
            # Simpan ke dalam format CSV
            export_path = os.path.join(EXPORT_DIR, f'{table}.csv')
            df.to_csv(export_path, index=False)
            print(f"[OK] Berhasil mengekstrak tabel '{table}' -> {export_path}")
        except Exception as e:
            print(f"[ERROR] Gagal mengekstrak tabel '{table}': {e}")
            
    print(f"\nSelesai! Semua data telah berhasil diekstrak ke dalam folder: {EXPORT_DIR}")

if __name__ == "__main__":
    export_all_tables()
