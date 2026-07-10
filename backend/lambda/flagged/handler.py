"""
MediVerify AI - /flagged Lambda

AWS-native replacement for the original FastAPI GET /flagged route.
Reads the audit trail from the DynamoDB flagged-entries table instead
of a local flagged_log.json file. Same response shape (a JSON array)
as before, so no frontend changes are needed beyond the base URL.
"""
import os

import boto3

# responses.py is provided by the shared Lambda Layer (backend/lambda/common-layer)
from responses import json_response, error_response

dynamodb = boto3.resource("dynamodb")
FLAGGED_TABLE = dynamodb.Table(os.environ["FLAGGED_TABLE"])


def lambda_handler(event, context):  # noqa: ARG001
    if event.get("httpMethod") == "OPTIONS":
        return json_response(200, {})

    try:
        items = []
        resp = FLAGGED_TABLE.scan()
        items.extend(resp.get("Items", []))
        while "LastEvaluatedKey" in resp:
            resp = FLAGGED_TABLE.scan(ExclusiveStartKey=resp["LastEvaluatedKey"])
            items.extend(resp.get("Items", []))

        items.sort(key=lambda i: i.get("timestamp", ""), reverse=True)
        return json_response(200, items)

    except Exception as exc:  # noqa: BLE001
        print(f"Error reading flagged logs from DynamoDB: {exc}")
        return error_response(500, f"Error reading flagged logs: {exc}")
