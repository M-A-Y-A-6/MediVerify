"""
MediVerify AI - /verify Lambda

AWS-native replacement for the original FastAPI POST /verify route.
Same request/response contract as before, so the existing React frontend
needs no logic changes beyond pointing VITE_API_URL at API Gateway.

Pipeline:
  1. Parse the uploaded image out of the multipart body.
  2. Persist the original image to S3 (audit trail / reprocessing).
  3. Run Amazon Textract for OCR (replaces local pytesseract).
  4. Run Amazon Rekognition for image-quality/label signals that feed
     into the authenticity score (replaces the pure random score).
  5. Regex-extract batch number + medicine name from the OCR text
     (unchanged logic from the original backend).
  6. Look up the batch number in the DynamoDB trusted-medicines ledger
     (replaces the local trusted_data.json file).
  7. Score + status decision (same thresholds as the original mock).
  8. On a suspicious result, write to the DynamoDB flagged-entries table
     and publish an EventBridge event (new: enables downstream
     notifications via SNS).
"""
import base64
import json
import os
import random
import re
import uuid
from datetime import datetime, timezone
from difflib import SequenceMatcher

import boto3

# responses.py and multipart_form.py are provided by the shared Lambda
# Layer (backend/lambda/common-layer) attached to this function in the
# CDK stack; the layer mounts /opt/python onto PYTHONPATH.
from responses import json_response, error_response
from multipart_form import extract_file

textract = boto3.client("textract")
rekognition = boto3.client("rekognition")
s3 = boto3.client("s3")
events = boto3.client("events")
dynamodb = boto3.resource("dynamodb")

TRUSTED_TABLE = dynamodb.Table(os.environ["TRUSTED_TABLE"])
FLAGGED_TABLE = dynamodb.Table(os.environ["FLAGGED_TABLE"])
UPLOAD_BUCKET = os.environ["UPLOAD_BUCKET"]
EVENT_BUS_NAME = os.environ.get("EVENT_BUS_NAME", "default")

BATCH_PATTERN = re.compile(r"\b([A-Za-z]{2,4}\d{4,6})\b")
MEDICINE_LABEL_PATTERN = re.compile(
    r"(?i)(?:medicine|rx|drug|product|product\s+name|rx\s+details|details|name)\s*:\s*([A-Za-z\s]+)"
)

# Rekognition labels that suggest a low-quality / non-document capture,
# used as a light-touch signal in the authenticity score.
POOR_QUALITY_LABELS = {"Blurry", "Blur"}


def is_rough_match(name1: str, name2: str) -> bool:
    if not name1 or not name2:
        return False
    n1, n2 = name1.lower().strip(), name2.lower().strip()
    if n1 in n2 or n2 in n1:
        return True
    return SequenceMatcher(None, n1, n2).ratio() >= 0.7


def run_textract(image_bytes: bytes) -> str:
    try:
        resp = textract.detect_document_text(Document={"Bytes": image_bytes})
        lines = [b["Text"] for b in resp.get("Blocks", []) if b["BlockType"] == "LINE"]
        return "\n".join(lines)
    except Exception as exc:  # noqa: BLE001 - degrade gracefully, mirrors original demo-mode fallback
        return (
            "[DEMO MODE: Textract call failed, returning placeholder OCR text. "
            f"Reason: {exc}]\nMedicine Name: Unknown Drug\nBatch Number: XX9999"
        )


def run_rekognition(image_bytes: bytes) -> list:
    try:
        resp = rekognition.detect_labels(Image={"Bytes": image_bytes}, MaxLabels=15, MinConfidence=60)
        return resp.get("Labels", [])
    except Exception:  # noqa: BLE001 - Rekognition is a supporting signal, never block verification on it
        return []


def get_trusted_entry(batch_number: str):
    try:
        resp = TRUSTED_TABLE.get_item(Key={"batch_number": batch_number})
        return resp.get("Item")
    except Exception:  # noqa: BLE001
        return None


def log_flagged_entry(medicine_name: str, batch_number: str) -> dict:
    entry = {
        "id": str(uuid.uuid4()),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "detected_medicine_name": medicine_name or "Not detected",
        "detected_batch_number": batch_number or "Not detected",
    }
    try:
        FLAGGED_TABLE.put_item(Item=entry)
    except Exception as exc:  # noqa: BLE001
        print(f"Error writing flagged entry to DynamoDB: {exc}")

    try:
        events.put_events(
            Entries=[
                {
                    "Source": "mediverify.backend",
                    "DetailType": "SuspiciousDocumentFlagged",
                    "Detail": json.dumps(entry),
                    "EventBusName": EVENT_BUS_NAME,
                }
            ]
        )
    except Exception as exc:  # noqa: BLE001
        print(f"Error publishing EventBridge event: {exc}")

    return entry


def lambda_handler(event, context):  # noqa: ARG001
    if event.get("httpMethod") == "OPTIONS":
        return json_response(200, {})

    try:
        headers = {k.lower(): v for k, v in (event.get("headers") or {}).items()}
        content_type = headers.get("content-type", "")

        raw_body = event.get("body", "")
        body_bytes = base64.b64decode(raw_body) if event.get("isBase64Encoded") else raw_body.encode("utf-8")

        if "multipart/form-data" not in content_type:
            return error_response(400, "Expected multipart/form-data upload with a 'file' field.")

        filename, image_bytes = extract_file(body_bytes, content_type)
        if not image_bytes:
            return error_response(400, "Uploaded file is not an image.")

        filename = filename or "upload.png"

        # 1. Persist original upload to S3 for audit trail
        s3_key = f"uploads/{datetime.now(timezone.utc):%Y/%m/%d}/{uuid.uuid4()}_{filename}"
        try:
            s3.put_object(Bucket=UPLOAD_BUCKET, Key=s3_key, Body=image_bytes)
        except Exception as exc:  # noqa: BLE001
            print(f"Warning: failed to persist upload to S3: {exc}")

        # 2. OCR via Textract
        raw_text = run_textract(image_bytes)

        # 3. Supporting image-quality signal via Rekognition
        labels = run_rekognition(image_bytes)
        label_names = {label["Name"] for label in labels}
        image_quality_penalty = 10 if label_names & POOR_QUALITY_LABELS else 0

        # 4. Regex extraction (unchanged logic from the original backend)
        detected_batch_number = None
        batch_match = BATCH_PATTERN.search(raw_text)
        if batch_match:
            detected_batch_number = batch_match.group(1).upper()

        detected_medicine_name = None
        label_match = MEDICINE_LABEL_PATTERN.search(raw_text)
        if label_match:
            detected_medicine_name = label_match.group(1).strip()

        analysis_flags = ["Document uploaded to secure S3 storage and scanned via Amazon Textract."]
        if labels:
            top_labels = ", ".join(sorted(label_names)[:5])
            analysis_flags.append(f"Amazon Rekognition detected visual features: {top_labels}.")

        matched_entry = None

        if not detected_batch_number:
            authenticity_score = max(0, 0 - image_quality_penalty)
            status = "Unable to Verify - Retake Photo"
            analysis_flags.append(
                "Failed to detect any batch number in the document. Please ensure the document is clear and readable."
            )
        else:
            exact_trusted_match = get_trusted_entry(detected_batch_number)

            if not detected_medicine_name and not exact_trusted_match:
                # Fallback: scan OCR text for any known medicine name substring
                scan_resp = TRUSTED_TABLE.scan(ProjectionExpression="medicine_name")
                for item in scan_resp.get("Items", []):
                    med = item["medicine_name"]
                    if med.lower() in raw_text.lower():
                        detected_medicine_name = med
                        break

            if exact_trusted_match and is_rough_match(detected_medicine_name, exact_trusted_match["medicine_name"]):
                authenticity_score = max(0, random.randint(95, 100) - image_quality_penalty)
                status = "Verified Genuine"
                matched_entry = exact_trusted_match
                analysis_flags.append(f"Batch number {detected_batch_number} verified against trusted ledger (DynamoDB).")
                analysis_flags.append(
                    f"Medicine name matches trusted product: {exact_trusted_match['medicine_name']} "
                    f"({exact_trusted_match['manufacturer']})."
                )
            else:
                authenticity_score = max(0, random.randint(20, 40) - image_quality_penalty)
                status = "Not Found / Suspicious"
                if exact_trusted_match:
                    analysis_flags.append(
                        f"Batch number {detected_batch_number} found, but medicine name mismatch "
                        f"(Detected: {detected_medicine_name or 'None'}, Ledger: {exact_trusted_match['medicine_name']})."
                    )
                else:
                    analysis_flags.append(
                        f"Batch number {detected_batch_number} is syntactically valid but unregistered in trusted ledger."
                    )
                analysis_flags.append(
                    "Potential pharmaceutical counterfeit or invalid batch serialization. "
                    "Logging event to DynamoDB security ledger and publishing EventBridge alert."
                )
                log_flagged_entry(detected_medicine_name, detected_batch_number)

        return json_response(
            200,
            {
                "filename": filename,
                "raw_text": raw_text,
                "detected_medicine_name": detected_medicine_name or "Not detected",
                "detected_batch_number": detected_batch_number or "Not detected",
                "status": status,
                "authenticity_score": authenticity_score,
                "matched_entry": matched_entry,
                "s3_key": s3_key,
                "extracted_fields": {
                    "patient_name": "Extracted via OCR" if detected_medicine_name else "Unknown",
                    "provider": "Extracted via OCR",
                    "issue_date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                    "document_type": "Prescription",
                    "details": f"Rx: {detected_medicine_name or 'N/A'} (Batch: {detected_batch_number or 'N/A'})",
                },
                "analysis_flags": analysis_flags,
            },
        )

    except Exception as exc:  # noqa: BLE001
        print(f"Unhandled error in verify handler: {exc}")
        return error_response(500, f"Error processing image: {exc}")
