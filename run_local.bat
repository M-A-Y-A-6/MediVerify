@echo off
echo ==========================================
echo Starting MediVerify AI Services...
echo ==========================================

REM Start Python FastAPI backend
echo Launching Backend server on http://localhost:8000...
start "MediVerify Backend" cmd /k "cd backend && pip install -r requirements.txt && python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload"

REM Start Vite React frontend
echo Launching Frontend server on http://localhost:5173...
start "MediVerify Frontend" cmd /k "cd frontend && npm install && npm run dev"

echo Services have been launched in separate console windows.
echo - Backend: http://localhost:8000
echo - Frontend: http://localhost:5173
echo ==========================================
pause
