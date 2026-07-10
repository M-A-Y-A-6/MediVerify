"""
MediVerify AI - /chat Lambda (new endpoint)

Powers the "Security Response Desk" chat panel in the frontend with a
real Amazon Bedrock model, replacing the previous hardcoded/simulated
bot responses. The frontend UI is unchanged; only the data source
behind handleSendMessage() changed from a setTimeout mock to this
endpoint.

Request:  { "message": "..." }
Response: { "reply": "..." }

Falls back to a friendly canned message on any Bedrock error, so the
chat panel degrades gracefully rather than showing a broken UI (e.g.
before Bedrock model access has been enabled in the AWS account).
"""
import json
import os

import boto3

# responses.py is provided by the shared Lambda Layer (backend/lambda/common-layer)
from responses import json_response, error_response

bedrock = boto3.client("bedrock-runtime")

MODEL_ID = os.environ.get("BEDROCK_MODEL_ID", "anthropic.claude-3-haiku-20240307-v1:0")

SYSTEM_PROMPT = (
    "You are the MediVerify AI Assistant, embedded in a medicine authenticity "
    "verification app. You help users understand batch code validation, what a "
    "'Not Found / Suspicious' scan result means, how the points/rewards system "
    "works, and general guidance on scanning medicine documents clearly. Keep "
    "answers concise (2-4 sentences), friendly, and focused on the app's "
    "clinical-security purpose. If asked something unrelated, politely steer "
    "the conversation back to document verification."
)

FALLBACK_REPLY = (
    "I'm having trouble reaching the AI assistant right now. In the meantime: "
    "batch numbers are usually printed on the medicine vial or prescription "
    "sheet, and any mismatch between the medicine name and batch code will be "
    "flagged automatically in the Scanner tab."
)


def lambda_handler(event, context):  # noqa: ARG001
    if event.get("httpMethod") == "OPTIONS":
        return json_response(200, {})

    try:
        raw_body = event.get("body") or "{}"
        payload = json.loads(raw_body)
        user_message = (payload.get("message") or "").strip()

        if not user_message:
            return error_response(400, "message is required")

        try:
            bedrock_resp = bedrock.invoke_model(
                modelId=MODEL_ID,
                body=json.dumps(
                    {
                        "anthropic_version": "bedrock-2023-05-31",
                        "max_tokens": 300,
                        "system": SYSTEM_PROMPT,
                        "messages": [{"role": "user", "content": user_message}],
                    }
                ),
                contentType="application/json",
                accept="application/json",
            )
            response_payload = json.loads(bedrock_resp["body"].read())
            reply = response_payload["content"][0]["text"]
            return json_response(200, {"reply": reply})

        except Exception as bedrock_exc:  # noqa: BLE001
            print(f"Bedrock invocation failed, using fallback reply: {bedrock_exc}")
            return json_response(200, {"reply": FALLBACK_REPLY})

    except Exception as exc:  # noqa: BLE001
        print(f"Unhandled error in chat handler: {exc}")
        return error_response(500, f"Error processing chat message: {exc}")
