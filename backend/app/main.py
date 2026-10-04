"""
FastAPI Application Entrypoint
Uses absolute imports starting with 'app.' for Vercel deployment.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

# Absolute import starting with 'app.'
from app.api.routes import router

load_dotenv()

app = FastAPI(title="NaviGraph FastAPI Backend", version="1.0.0")

# CORS middleware for frontend connection
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API routes
app.include_router(router)
