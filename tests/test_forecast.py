import math
from pathlib import Path

from backend import agent
from backend.forecast import build

M = build(Path(__file__).resolve().parents[1] / "data" / "generation_forecast.csv")


def test_attribution_sums_to_error():
    for i in M.df.index:
        e = M.explain_row(i)
        assert math.isclose(sum(s["value"] for s in e["steps"]), e["error_mwh"], abs_tol=1e-9)


def test_backtest_never_trains_on_future_days():
    assert M.backtest["row_id"].min() >= M.df[M.df["day"] >= M.first_test_day]["row_id"].min()


def test_outage_is_the_reliable_driver():
    d = {x["key"]: x for x in M.drivers()}
    assert d["outage_flag"]["reliable"] and d["outage_flag"]["coef"] < 0


def test_agent_handles_date_and_missing_date():
    assert agent.run(M, "why aug 15?")["intent"] == "row"
    assert agent.run(M, "2030-01-01")["intent"] == "not_found"
