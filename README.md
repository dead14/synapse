Synapse - ILI Data Alignment Platform
Synapse is a modern, enterprise-grade web application designed for Pipeline Integrity Management. It automates the ingestion, alignment, and analysis of In-Line Inspection (ILI) data from multiple surveys and vendors.

By leveraging advanced mathematical algorithms (Dynamic Time Warping and Hungarian Bipartite Matching), Synapse eliminates the manual labor required to match thousands of pipeline features (welds, anomalies, bends) across different inspection years.

🚀 Key Features
Vendor-Agnostic Data Ingestion: Seamlessly upload ILI Excel/CSV files from any vendor (ROSEN, LINSCAN, 3P, etc.). The built-in Smart Auto-Detection Engine automatically detects, translates, and maps column headers to a universal standard using a massive PostgreSQL synonym dictionary and fuzzy matching.
Interactive DTW Engine: An interactive "GW Simulator" that uses Dynamic Time Warping to match Girth Welds (anchor points) between two survey runs. Users can adjust Out-of-Tolerance (OTA) thresholds on the fly and lock/unlock specific welds with real-time recalculations.
Hungarian Alignment Engine: Once anchors are set, the system offloads heavy computations to a background queue (BullMQ/Redis) running the Hungarian Algorithm to map every single individual feature (anomalies, valves, sleeves) with high precision.
Modern Visualization: A highly responsive, glassmorphism-inspired React frontend for visualizing matched data, comparing degradation over time, and interacting with the pipeline layout.
Enterprise Security: JWT-based authentication system with role-based access control, secure password reset flows, and OTP verification.
🏗️ Architecture Stack
Frontend: React, TypeScript, TailwindCSS/Vanilla CSS (Modern UI)
Backend: Node.js (Express) & Python 3.14 (Data Processing Engines)
Database: PostgreSQL (SQLAlchemy ORM)
Queue System: Redis & BullMQ (Background Workers)
⚙️ Quick Start Setup
Prerequisites
Node.js (v18+)
Python (v3.14+)
PostgreSQL (running locally on port 5432)
Redis Server (running locally on port 6379)
1. Database Initialization
Ensure PostgreSQL is running, then run the database seeder to generate the tables and the Synonym Dictionary pool:

bash

cd backend
pip install -r requirements.txt
python seed_dictionary.py
2. Start the Backend
The backend utilizes both Node.js for API routes and Python for heavy mathematical processing.

bash

# Terminal 1: Start Backend API (Node)
cd backend
npm install
npm run dev
# Terminal 2: Start Background Worker (Redis/BullMQ)
cd backend
node src/modules/alignment/alignmentWorker.js
3. Start the Frontend
bash

# Terminal 3: Start React UI
cd frontend
npm install
npm run dev
The application will be available at http://localhost:5173.

💡 Usage Workflow
Upload: Upload historical and current ILI runs in the dashboard.
Setup Session: Select two runs to compare.
Anchor Matching: Use the GW Simulator to match girth welds interactively.
Detailed Alignment: Accept the anchors to trigger the background Hungarian engine for deep anomaly matching.
Analyze: View the generated reports and side-by-side deterioration analysis.
Developed for Advanced Pipeline Integrity & Health Management.
