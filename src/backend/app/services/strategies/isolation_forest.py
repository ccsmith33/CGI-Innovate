from datetime import datetime

import numpy as np
from sklearn.ensemble import IsolationForest


def detect_anomalies(
    timestamps: list[datetime],
    stock_levels: list[float],
) -> list[dict]:
    """Run IsolationForest on resource log data and return anomalous points."""
    if len(timestamps) < 2:
        return []

    X = np.array(stock_levels).reshape(-1, 1)

    model = IsolationForest(contamination=0.05, random_state=42)
    model.fit(X)

    scores = model.decision_function(X)
    predictions = model.predict(X)

    anomalies = []
    for i, pred in enumerate(predictions):
        if pred == -1:
            anomalies.append({
                "timestamp": timestamps[i].isoformat(),
                "stock_level": stock_levels[i],
                "score": float(scores[i]),
            })

    return anomalies
