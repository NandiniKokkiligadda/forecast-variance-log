# Power Generation Forecasting & Variance Explanation Agent

Forecasts renewable generation, measures how the operator forecast misses actual output, and explains each miss in terms of irradiance, wind speed, temperature and outage flags. FastAPI backend, React frontend, deployable to Railway.

## What it does

- **Baseline model:** linear regression of `actual_mwh` on irradiance, wind speed, temperature and the outage flag.
- **Variance analysis:** a second linear model on `error = actual − forecast` splits every miss exactly into *typical bias + irradiance + wind + temperature + outage + unexplained*. Coefficient intervals come from 300 bootstrap resamples.
- **Explanation agent:** answers questions such as "why was Aug 15 off?", "worst 3 misses", "what do outages cost us?". It is deterministic, so every number traces to the model. If `ANTHROPIC_API_KEY` is set it additionally rewrites the finished findings as a short summary; if the call fails it falls back to the rule-based text. No keys are stored in the repo.
- **React UI:** forecast-vs-actual timeline, per-day miss waterfall, agent chat, evaluation tables and limitations.

## Run locally

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn backend.app:app --port 8000      # http://localhost:8000
python -m backend.forecast               # evaluation printed to the terminal
python -m pytest tests                   # optional: pip install pytest
```

`frontend/dist` is committed, so the app serves the React UI with no Node step.

### Frontend development

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173, proxies /api to localhost:8000
npm run build      # writes frontend/dist; commit it before deploying
```

## Deploy to Railway

1. Push this folder to a GitHub repository.
2. In Railway: **New Project → Deploy from GitHub repo** and select it.
3. Railway detects Python from `requirements.txt` and runs the `Procfile` command (`uvicorn backend.app:app --host 0.0.0.0 --port $PORT`). `.python-version` pins Python 3.11.
4. Open **Settings → Networking → Generate Domain** and add the URL to your submission.
5. Optional: add `ANTHROPIC_API_KEY` (and `LLM_MODEL`) under **Variables** for LLM summaries.

Check `https://<your-domain>/api/health` returns `{"status":"ok","rows":60}`.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | liveness check |
| GET | `/api/demo` | service description |
| GET | `/api/data` | rows with forecast, actual, miss and fitted baseline |
| GET | `/api/metrics` | backtest results for the three methods |
| GET | `/api/drivers` | miss-model coefficients with 90% intervals |
| GET | `/api/explain/{row_id}` | exact breakdown of one row's miss |
| POST | `/api/run` | `{"text": "..."}` → answer, reasoning steps, evidence rows, metrics, limitations |

## Data and assumptions

`data/generation_forecast.csv` has 60 rows: 30 dates, each appearing twice, with no site column. Repeated dates are treated as two parallel generating blocks, **A** and **B**, in order of appearance. Convention: `error = actual − forecast`, so negative means shortfall.

## Evaluation

Expanding-window backtest: train on all earlier days, test on the next two days, starting at day 15 of 30 (32 test rows, 2 with an outage). Models never see future days.

| Method | MAE (MWh) | RMSE | WAPE | MAE, no outage days |
|---|---:|---:|---:|---:|
| Operator forecast (as supplied) | 5.06 | 5.93 | 8.8% | 4.56 |
| Baseline regression (weather + outage) | 6.47 | 7.48 | 11.3% | 6.19 |
| Operator forecast + outage correction | **4.55** | **5.07** | **7.9%** | **4.40** |

- The weather-only baseline is **worse** than the operator forecast. It is a transparent floor to beat, not a replacement.
- The only reliable driver of forecast miss is the **outage flag**: about −12.4 MWh per flagged row (90% interval −18.1 to −8.1). Irradiance, wind speed and temperature have intervals that include zero.
- The four inputs explain about 25% of the variance in the miss; the rest is unexplained.

## Limitations

- Small sample (60 rows, 3 outages); results are indicative, not statistically strong.
- Linear, additive attribution; interactions (for example curtailment) are missed.
- Weather inputs are observations, not the forecasts the operator used, so weather forecast error cannot be separated from model error.
- The outage correction is learned from only a few events, and the backtest includes just 2 outage rows.
- Dummy data; no claim about real plant performance.

## Next steps for production

Use a real site identifier and timestamps at sub-daily resolution; add numerical weather forecasts as inputs; try gradient-boosted models with a physical power-curve feature; track forecast error continuously with alerting; log agent questions and answers; add authentication and rate limiting to the API.

## Layout

```
backend/    forecast.py (model, backtest, attribution)  agent.py  app.py
frontend/   Vite + React source (src/), built bundle in dist/
data/       generation_forecast.csv
tests/      test_forecast.py
Procfile  requirements.txt  .python-version
```
