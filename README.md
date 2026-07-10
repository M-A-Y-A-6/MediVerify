# MediVerify AI — AWS Hackathon Edition

MediVerify AI is a medical document authenticity scanner and counterfeit
detection app. Users photograph or upload a medicine label/prescription;
the backend OCRs it, extracts a batch number and medicine name, checks it
against a trusted ledger, and returns an authenticity score with a full
audit trail.

This version replaces the original local FastAPI + pytesseract backend with
a **fully serverless AWS architecture**, while leaving the React frontend's
UI, layout, and navigation exactly as they were.

## Project Overview

- **Frontend**: Vite + React 19 + TypeScript + Tailwind CSS, packaged for
  Android via Capacitor. Unchanged visually — only the data layer
  (auth, verification, chat) now talks to AWS instead of localStorage/a
  local server.
- **Backend**: AWS Lambda functions behind API Gateway, replacing the
  FastAPI server. Same request/response contracts for `/verify` and
  `/flagged`, plus a new `/chat` endpoint.
- **Infrastructure**: AWS CDK (TypeScript), matching the project's existing
  TS-first approach — one command deploys everything.

## AWS Services Used

| Service | Purpose |
|---|---|
| **API Gateway** | Public REST API for the frontend |
| **Lambda** | Serverless compute for `/verify`, `/flagged`, `/chat` |
| **Amazon Textract** | OCR of uploaded document images (replaces pytesseract) |
| **Amazon Rekognition** | Image-quality/label signal feeding the authenticity score |
| **DynamoDB** | Trusted-medicines ledger + flagged/audit log (replaces local JSON files) |
| **S3** | Stores uploaded document images for the audit trail |
| **Cognito** | Real user authentication (replaces localStorage mock) |
| **Bedrock** | Claude-powered chat assistant (replaces hardcoded chat responses) |
| **EventBridge + SNS** | Event-driven alerting when a document is flagged suspicious |
| **CloudWatch** | Logs and metrics for every Lambda + API Gateway |

Full rationale for each service: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Data Flow (short version)

1. User uploads/captures a document image in the app.
2. Image goes to API Gateway → `verify` Lambda.
3. Lambda stores the image in S3, runs Textract for OCR, runs Rekognition
   for a supporting image-quality signal.
4. Regex extracts a batch number + medicine name from the OCR text.
5. Lambda looks up the batch number in the DynamoDB trusted ledger.
6. Verified → returns a high score. Suspicious/unmatched → returns a low
   score, logs to the DynamoDB flagged table, and publishes an EventBridge
   event that fans out to an SNS alert topic.
7. Chat panel messages go to a separate `chat` Lambda, which calls Bedrock
   (Claude Haiku) for a real AI response.

Full sequence diagram: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Project Structure

```
MediVerify/
├── frontend/                  # Vite + React + TS + Tailwind (UI unchanged)
│   └── src/
│       ├── App.tsx            # Screens/navigation (unchanged), now calls lib/api.ts + lib/auth.ts
│       └── lib/
│           ├── awsConfig.ts    # Reads VITE_* env vars
│           ├── auth.ts         # Cognito sign up/in/out helpers
│           └── api.ts          # verify / flagged / chat API client
├── backend/
│   ├── main.py                 # Original local FastAPI server (kept for offline dev, see docs/DEPLOYMENT.md)
│   ├── trusted_data.json       # Source data, seeded into DynamoDB
│   ├── lambda/
│   │   ├── verify/handler.py   # POST /verify — Textract + Rekognition + DynamoDB + S3 + EventBridge
│   │   ├── flagged/handler.py  # GET /flagged — reads DynamoDB audit log
│   │   ├── chat/handler.py     # POST /chat — Bedrock-powered assistant
│   │   └── common-layer/       # Shared Lambda Layer (CORS/JSON helpers, multipart parser)
│   └── scripts/
│       └── seed_trusted_medicines.py  # Loads trusted_data.json into DynamoDB
├── infrastructure/             # AWS CDK (TypeScript) — deploys everything above
│   ├── bin/mediverify.ts
│   └── lib/mediverify-stack.ts
└── docs/
    ├── ARCHITECTURE.md         # Mermaid diagrams + service rationale
    ├── DEPLOYMENT.md           # Step-by-step deploy guide
    └── AWS_SETUP.md            # Manual AWS Console steps (Bedrock access, IAM notes)
```

## Deployment Steps (quick reference)

Full guide: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

```bash
# 1. Deploy AWS infrastructure
cd infrastructure && npm install && npx cdk bootstrap && npx cdk deploy

# 2. Seed the trusted-medicines ledger
cd ../backend/scripts && python seed_trusted_medicines.py --table MediVerify-TrustedMedicines

# 3. Configure and run the frontend
cd ../../frontend && cp .env.example .env   # fill in CDK outputs
npm install && npm run dev
```

## Environment Variables

**`frontend/.env`** (see `frontend/.env.example`):

```
VITE_API_URL=https://<api-id>.execute-api.<region>.amazonaws.com/prod
VITE_AWS_REGION=us-east-1
VITE_COGNITO_USER_POOL_ID=<from cdk output>
VITE_COGNITO_CLIENT_ID=<from cdk output>
```

Leaving the Cognito values blank keeps the app on its original
localStorage-only mock login — handy for pure UI work without deploying
any AWS resources.

**`infrastructure/.env`** (see `infrastructure/.env.example`): AWS
account/region for CDK, and the Bedrock model ID used by the chat Lambda.

## AWS Resource Setup

One manual step is required before the chat assistant returns live AI
replies: enabling Bedrock model access for Claude Haiku in your account.
See [`docs/AWS_SETUP.md`](docs/AWS_SETUP.md) for this and other
IAM/Cognito/DynamoDB notes.

## Future Improvements

- Scope the Bedrock and Textract/Rekognition IAM policies to specific
  resource ARNs (currently `"*"`, standard for these services but worth
  tightening for a non-prototype deployment).
- Add a Cognito post-confirmation Lambda trigger to auto-provision a user
  profile record in DynamoDB (points, level, history) instead of keeping
  those in the browser's localStorage.
- Move scan history from localStorage into DynamoDB, keyed by Cognito user
  ID, so it syncs across devices.
- Add S3 Object Lambda or a step in the `verify` function to run actual
  pixel-level tamper detection (e.g. ELA-style analysis) rather than relying
  solely on Rekognition labels.
- Add API Gateway usage plans / throttling and a WAF in front of the API
  for anything beyond a demo.

## Local Development Without AWS

The original local FastAPI backend is untouched and still works for
frontend-only development — see the "Local development without AWS" section
of [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).
