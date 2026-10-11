from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import agent
from .forecast import build

BASE = Path(__file__).resolve().parents[1]
DATA = BASE / 'data'
DIST = BASE / 'frontend' / 'dist'

app = FastAPI(title='Power Generation Forecasting & Variance Explanation Agent')
MODEL = build(DATA / 'generation_forecast.csv')


class Query(BaseModel):
    text: str = ''
    llm: bool = True  # the UI sets this to false for the automatic per-day summary


@app.get('/api/health')
def health():
    return {'status': 'ok', 'rows': len(MODEL.df)}


@app.get('/api/demo')
def demo():
    return {
        'case_study': 'Power Generation Forecasting & Variance Explanation Agent',
        'status': 'running',
        'rows': len(MODEL.df),
        'endpoints': ['/api/data', '/api/metrics', '/api/drivers', '/api/explain/{row_id}', 'POST /api/run'],
    }


@app.get('/api/data')
def data():
    return {'rows': MODEL.records()}


@app.get('/api/metrics')
def metrics():
    return MODEL.metrics()


@app.get('/api/drivers')
def drivers():
    return {'drivers': MODEL.drivers(), 'r2': MODEL.error_r2, 'typical_bias': MODEL.bias}


@app.get('/api/explain/{row_id}')
def explain(row_id: int):
    if row_id not in MODEL.df.index:
        raise HTTPException(status_code=404, detail='Unknown row_id')
    return MODEL.explain_row(row_id)


@app.post('/api/run')
def run_case(query: Query):
    return agent.run(MODEL, query.text, use_llm=query.llm)


# Serve the built React app (frontend/dist). API routes above take priority.
if DIST.exists():
    app.mount('/assets', StaticFiles(directory=DIST / 'assets'), name='assets')

    @app.get('/{path:path}', include_in_schema=False)
    def spa(path: str):
        if path.startswith('api/'):
            raise HTTPException(status_code=404)
        target = (DIST / path).resolve()
        if path and target.is_file() and DIST.resolve() in target.parents:
            return FileResponse(target)
        return FileResponse(DIST / 'index.html')
