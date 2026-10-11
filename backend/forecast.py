"""Baseline forecasting model and variance (forecast-miss) attribution.

Three things live here:

1. ``load_data``      - read and validate the bundled CSV.
2. ``ForecastModel``  - a weather-driven baseline regression, an expanding-window
                        backtest that compares it with the operator forecast, and a
                        linear error model that splits each miss into drivers.
3. ``python -m backend.forecast`` prints the evaluation to the terminal.

Convention used everywhere: error = actual - forecast.
Negative error = shortfall (the plant under-delivered against the forecast).
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import LinearRegression

FEATURES = ["irradiance_wm2", "wind_speed_ms", "temperature_c", "outage_flag"]
REQUIRED = ["date", *FEATURES, "forecast_mwh", "actual_mwh"]
LABELS = {
    "irradiance_wm2": "Irradiance",
    "wind_speed_ms": "Wind speed",
    "temperature_c": "Temperature",
    "outage_flag": "Outage",
}
UNITS = {
    "irradiance_wm2": "W/m²",
    "wind_speed_ms": "m/s",
    "temperature_c": "°C",
    "outage_flag": "",
}
METHODS = {
    "operator": "Operator forecast (as supplied)",
    "baseline": "Baseline regression (weather + outage)",
    "adjusted": "Operator forecast + outage correction",
}


def load_data(path: Path | str) -> pd.DataFrame:
    df = pd.read_csv(path)
    missing = [c for c in REQUIRED if c not in df.columns]
    if missing:
        raise ValueError(f"CSV is missing columns: {missing}")
    df = df.dropna(subset=REQUIRED).copy()
    df["date"] = pd.to_datetime(df["date"])
    if not df["outage_flag"].isin([0, 1]).all():
        raise ValueError("outage_flag must be 0 or 1")
    # The file has two rows per date and no site column. Treat repeated dates as
    # parallel generating blocks, labelled A, B in order of appearance.
    df["block"] = df.groupby("date").cumcount().map(lambda n: chr(65 + int(n)))
    df = df.sort_values(["date", "block"]).reset_index(drop=True)
    df["row_id"] = df.index
    df["day"] = df["date"].rank(method="dense").astype(int) - 1
    df["error_mwh"] = df["actual_mwh"] - df["forecast_mwh"]
    return df


def score(actual: pd.Series, predicted: pd.Series) -> dict:
    err = actual.to_numpy() - np.asarray(predicted)
    return {
        "mae": float(np.abs(err).mean()),
        "rmse": float(np.sqrt((err**2).mean())),
        "wape": float(np.abs(err).sum() / actual.sum()),
        "mean_error": float(err.mean()),  # actual - predicted; negative = over-forecast
        "n": int(len(err)),
    }


class ForecastModel:
    def __init__(self, df: pd.DataFrame, first_test_day: int = 14, step: int = 2, n_boot: int = 300):
        self.df = df
        self.first_test_day = first_test_day
        self.step = step

        # Final models fit on every row (used for display and attribution).
        self.baseline = LinearRegression().fit(df[FEATURES], df["actual_mwh"])
        self.error_model = LinearRegression().fit(df[FEATURES], df["error_mwh"])
        self.outage_fix = LinearRegression().fit(df[["outage_flag"]], df["error_mwh"])
        self.df["baseline_mwh"] = np.clip(self.baseline.predict(df[FEATURES]), 0, None)

        self.means = df[FEATURES].mean()
        self.bias = float(df["error_mwh"].mean())
        self.error_r2 = float(self.error_model.score(df[FEATURES], df["error_mwh"]))
        self._bootstrap(n_boot)
        self.backtest = self._backtest()

    # ---- validation -------------------------------------------------------
    def _backtest(self) -> pd.DataFrame:
        """Expanding window: train on all days before the fold, test on the next `step` days."""
        df, parts = self.df, []
        for start in range(self.first_test_day, int(df["day"].max()) + 1, self.step):
            tr = df[df["day"] < start]
            te = df[(df["day"] >= start) & (df["day"] < start + self.step)]
            if te.empty:
                continue
            base = LinearRegression().fit(tr[FEATURES], tr["actual_mwh"])
            fix = LinearRegression().fit(tr[["outage_flag"]], tr["error_mwh"])
            out = te[["row_id", "actual_mwh", "outage_flag"]].copy()
            out["operator"] = te["forecast_mwh"].to_numpy()
            out["baseline"] = np.clip(base.predict(te[FEATURES]), 0, None)
            out["adjusted"] = np.clip(te["forecast_mwh"].to_numpy() + fix.predict(te[["outage_flag"]]), 0, None)
            parts.append(out)
        return pd.concat(parts, ignore_index=True)

    def metrics(self) -> dict:
        bt = self.backtest
        table = []
        for key, label in METHODS.items():
            row = {"key": key, "label": label, **score(bt["actual_mwh"], bt[key])}
            normal = bt[bt["outage_flag"] == 0]
            row["mae_normal_days"] = float(np.abs(normal["actual_mwh"] - normal[key]).mean())
            table.append(row)
        return {
            "validation": (
                f"Expanding-window backtest: train on all earlier days, test on the next {self.step} days, "
                f"starting at day {self.first_test_day + 1} of {int(self.df['day'].max()) + 1}."
            ),
            "test_rows": int(len(bt)),
            "test_rows_with_outage": int(bt["outage_flag"].sum()),
            "table": table,
        }

    # ---- variance attribution --------------------------------------------
    def _bootstrap(self, n_boot: int) -> None:
        rng = np.random.default_rng(42)
        n, coefs = len(self.df), []
        for _ in range(n_boot):
            s = self.df.iloc[rng.integers(0, n, n)]
            if s["outage_flag"].sum() == 0:
                continue
            coefs.append(LinearRegression().fit(s[FEATURES], s["error_mwh"]).coef_)
        self.ci = np.percentile(np.array(coefs), [5, 95], axis=0)

    def drivers(self) -> list[dict]:
        out = []
        for i, f in enumerate(FEATURES):
            coef = float(self.error_model.coef_[i])
            lo, hi = float(self.ci[0][i]), float(self.ci[1][i])
            contrib = self.error_model.coef_[i] * (self.df[f] - self.means[f])
            out.append({
                "key": f, "label": LABELS[f], "unit": UNITS[f],
                "coef": coef, "ci_low": lo, "ci_high": hi,
                "reliable": bool(lo > 0 or hi < 0),
                "mean_abs_contribution": float(contrib.abs().mean()),
            })
        return out

    def explain_row(self, row_id: int) -> dict:
        """error = typical bias + sum(driver effects) + unexplained, exactly."""
        r = self.df.loc[row_id]
        steps = [{"key": "bias", "label": "Typical bias", "value": self.bias}]
        total = self.bias
        for i, f in enumerate(FEATURES):
            v = float(self.error_model.coef_[i] * (r[f] - self.means[f]))
            steps.append({"key": f, "label": LABELS[f], "value": v})
            total += v
        steps.append({"key": "unexplained", "label": "Unexplained", "value": float(r["error_mwh"] - total)})
        return {
            "row_id": int(row_id),
            "date": r["date"].strftime("%Y-%m-%d"),
            "block": r["block"],
            "forecast_mwh": float(r["forecast_mwh"]),
            "actual_mwh": float(r["actual_mwh"]),
            "error_mwh": float(r["error_mwh"]),
            "inputs": {f: float(r[f]) for f in FEATURES},
            "typical_inputs": {f: float(self.means[f]) for f in FEATURES},
            "steps": steps,
        }

    def records(self) -> list[dict]:
        d = self.df.copy()
        d["date"] = d["date"].dt.strftime("%Y-%m-%d")
        cols = ["row_id", "date", "block", "day", *FEATURES, "forecast_mwh", "actual_mwh", "error_mwh", "baseline_mwh"]
        d = d[cols].round(2)
        return d.to_dict("records")


def build(path: Path | str) -> ForecastModel:
    return ForecastModel(load_data(path))


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[1]
    m = build(root / "data" / "generation_forecast.csv")
    print(m.metrics()["validation"])
    print(f"{'method':45s} {'MAE':>6s} {'RMSE':>6s} {'WAPE':>6s} {'MAE(no outage)':>15s}")
    for r in m.metrics()["table"]:
        print(f"{r['label']:45s} {r['mae']:6.2f} {r['rmse']:6.2f} {r['wape']*100:5.1f}% {r['mae_normal_days']:15.2f}")
    print("\nDriver coefficients (MWh miss per unit, 90% bootstrap interval):")
    for d in m.drivers():
        print(f"  {d['label']:12s} {d['coef']:8.3f}  [{d['ci_low']:.3f}, {d['ci_high']:.3f}]  reliable={d['reliable']}")
    print(f"Error-model R2: {m.error_r2:.2f}")
