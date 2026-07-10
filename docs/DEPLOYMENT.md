# Deployment Guide

This guide deploys the AWS backend (API Gateway + Lambda + Textract +
Rekognition + DynamoDB + S3 + Cognito + Bedrock + EventBridge/SNS) and
connects the existing React frontend to it.

## Prerequisites

- Node.js 18+ and npm
- Python 3.12 (for the seed script)
- An AWS account with credentials configured (`aws configure`)
- AWS CDK v2 CLI: `npm install -g aws-cdk` (or use `npx cdk` per command)
- **Bedrock model access enabled** for `anthropic.claude-3-haiku-20240307-v1:0`
  in your account/region (AWS Console → Bedrock → Model access). The chat
  endpoint degrades gracefully if this isn't enabled, but won't return real
  AI replies until it is.

## 1. Deploy the AWS infrastructure

```bash
cd infrastructure
npm install
npx cdk bootstrap          # first time only, per account/region
npx cdk deploy
```

`cdk deploy` prints a set of outputs when it finishes, e.g.:

```
MediVerifyStack.ApiUrl = https://abc123xyz.execute-api.us-east-1.amazonaws.com/prod/
MediVerifyStack.UserPoolId = us-east-1_AbCdEfGhI
MediVerifyStack.UserPoolClientId = 1a2b3c4d5e6f7g8h9i0j
MediVerifyStack.UploadBucketName = mediverifystack-mediverifyuploadsbucket-xxxx
MediVerifyStack.TrustedTableName = MediVerify-TrustedMedicines
MediVerifyStack.FlaggedTableName = MediVerify-FlaggedEntries
MediVerifyStack.AlertTopicArn = arn:aws:sns:us-east-1:...:MediVerifySuspiciousAlerts
```

Keep this output — you'll need it for steps 2 and 3.

## 2. Seed the trusted-medicines ledger

Loads the original `backend/trusted_data.json` records into the new
DynamoDB table (one-time, or re-run any time you edit the JSON file):

```bash
cd backend/scripts
pip install boto3 --break-system-packages   # if boto3 isn't already available
python seed_trusted_medicines.py --table MediVerify-TrustedMedicines --region us-east-1
```

## 3. (Optional) Subscribe to suspicious-document alerts

```bash
aws sns subscribe \
  --topic-arn arn:aws:sns:us-east-1:<account-id>:MediVerifySuspiciousAlerts \
  --protocol email \
  --notification-endpoint you@example.com
```

Confirm the subscription via the email AWS sends you.

## 4. Configure and run the frontend

```bash
cd frontend
cp .env.example .env
```

Edit `.env` with the CDK outputs from step 1:

```
VITE_API_URL=https://abc123xyz.execute-api.us-east-1.amazonaws.com/prod
VITE_AWS_REGION=us-east-1
VITE_COGNITO_USER_POOL_ID=us-east-1_AbCdEfGhI
VITE_COGNITO_CLIENT_ID=1a2b3c4d5e6f7g8h9i0j
```

Then:

```bash
npm install
npm run dev
```

The app now talks to the deployed AWS backend. Leaving the two `VITE_COGNITO_*`
values blank keeps the app on the original localStorage-only mock login,
which is useful for pure UI work without any AWS resources deployed.

## 5. Building the Android app (unchanged)

The Capacitor/Android packaging is untouched — build the web app first,
then sync into the Android project as before:

```bash
cd frontend
npm run build
npx cap sync android
```

## Tearing everything down

```bash
cd infrastructure
npx cdk destroy
```

All resources in this stack use `RemovalPolicy.DESTROY` / `autoDeleteObjects`
so the stack cleans up fully — appropriate for a hackathon prototype, **not**
recommended as-is for a production deployment with real patient data.

## Local development without AWS (legacy mode)

The original local FastAPI backend (`backend/main.py`, pytesseract-based)
is left untouched and still works for offline frontend development:

```bash
cd backend
pip install -r requirements.txt --break-system-packages
uvicorn main:app --reload
```

Point `VITE_API_URL` at `http://localhost:8000` (the default) to use it.
