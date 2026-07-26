from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="Pipeline Integrity Suite API")

# Configure CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify exact origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class DashboardSummary(BaseModel):
    runs_aligned: int
    matched_features: int
    immediate_repair: int
    est_remaining_life_years: float

@app.get("/")
def read_root():
    return {"message": "Welcome to Pipeline Integrity Suite API"}

@app.get("/api/dashboard/summary", response_model=DashboardSummary)
def get_dashboard_summary():
    # Dummy data based on the UI provided
    return DashboardSummary(
        runs_aligned=3,
        matched_features=1284,
        immediate_repair=4,
        est_remaining_life_years=6.2
    )

@app.get("/api/dashboard/severity-chainage")
def get_severity_chainage():
    # Dummy data for the bar chart
    return {
        "labels": ["0m", "", "", "", "", "", "", "", "", "3,950m"],
        "severity": [15, 12, 45, 15, 85, 75, 20, 35, 10, 20],
        "colors": ["green", "green", "yellow", "green", "red", "red", "green", "yellow", "green", "green"]
    }
