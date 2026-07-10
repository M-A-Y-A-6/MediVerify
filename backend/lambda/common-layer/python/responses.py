"""
Shared HTTP response helper for MediVerify Lambda functions.

API Gateway (REST API, Lambda proxy integration) expects a dict with
statusCode / headers / body. Centralizing this keeps every function's
CORS behavior identical to the original FastAPI app (allow_origins=["*"]).
"""
import json
from decimal import Decimal


class _DecimalEncoder(json.JSONEncoder):
    """DynamoDB returns Decimal for numbers; make them JSON-serializable."""

    def default(self, o):
        if isinstance(o, Decimal):
            return int(o) if o % 1 == 0 else float(o)
        return super().default(o)


CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Allow-Methods": "OPTIONS,POST,GET",
    "Content-Type": "application/json",
}


def json_response(status_code: int, body: dict) -> dict:
    return {
        "statusCode": status_code,
        "headers": CORS_HEADERS,
        "body": json.dumps(body, cls=_DecimalEncoder),
    }


def error_response(status_code: int, detail: str) -> dict:
    return json_response(status_code, {"detail": detail})
