# AWS Resource Setup Guide

Most resources in this project are created automatically by the CDK stack
(`infrastructure/`). This doc covers the handful of things that need a
one-time manual step in the AWS Console, plus notes on the IAM permissions
the stack grants.

## 1. Enable Bedrock model access

Bedrock model access is opt-in per account/region and can't be granted via
CDK/CloudFormation.

1. AWS Console → **Amazon Bedrock** → **Model access** (left sidebar)
2. Click **Manage model access** / **Enable specific models**
3. Enable **Anthropic → Claude 3 Haiku**
4. Wait for status to show **Access granted** (usually instant for Haiku)

If this step is skipped, the `/chat` endpoint still returns HTTP 200 with a
friendly fallback message instead of a real AI reply — the app won't break,
it just won't have live chat until this is enabled.

## 2. AWS credentials for CDK deploy

Any of the standard methods work:

```bash
aws configure                     # access key / secret key
# or
aws sso login --profile your-sso  # IAM Identity Center
```

CDK reads the active profile/credentials the same way the AWS CLI does.

## 3. IAM permissions created by the stack

The stack follows least-privilege per function:

| Function | Permissions granted |
|---|---|
| `verify` | Read `TrustedMedicines` table; read/write `FlaggedEntries` table; read/write the uploads S3 bucket; `textract:DetectDocumentText`/`AnalyzeDocument`; `rekognition:DetectLabels`/`DetectModerationLabels`; `events:PutEvents` on the custom bus |
| `flagged` | Read `FlaggedEntries` table |
| `chat` | `bedrock:InvokeModel` |

Textract and Rekognition don't support resource-level IAM scoping, so those
statements use `Resource: "*"` (standard practice for these services). For a
production deployment, scope the Bedrock `InvokeModel` permission to the
specific model ARN(s) you use rather than `"*"`.

## 4. Cognito notes

- **Self-signup is enabled** with email as the sign-in alias and auto-verify
  on email — matches the app's existing email/password signup form.
- **No client secret** is generated (`generateSecret: false`), since the
  Cognito SDK calls happen directly from the browser (a public SPA client).
- Password policy: minimum 8 characters, at least one lowercase letter and
  one digit — intentionally lighter than Cognito's default to keep demo
  account creation fast; tighten `passwordPolicy` in
  `infrastructure/lib/mediverify-stack.ts` for anything beyond a hackathon.

## 5. DynamoDB tables

Both tables use **on-demand (PAY_PER_REQUEST)** billing — no capacity
planning needed for a prototype's traffic pattern.

| Table | Partition key | Purpose |
|---|---|---|
| `MediVerify-TrustedMedicines` | `batch_number` (String) | Trusted ledger, seeded from `backend/trusted_data.json` |
| `MediVerify-FlaggedEntries` | `id` (String, UUID) | Audit log of suspicious/unverified scans |

## 6. S3 bucket

- Blocks all public access; the frontend never reads directly from S3 — all
  access goes through the `verify` Lambda.
- `autoDeleteObjects: true` + `RemovalPolicy.DESTROY` so `cdk destroy` fully
  tears down the bucket for a clean hackathon demo environment. Remove both
  for anything longer-lived.

## 7. EventBridge + SNS

- A custom event bus (`mediverify-events`) keeps MediVerify's events
  separate from the account's default bus.
- The `SuspiciousDocumentRule` matches `source: mediverify.backend`,
  `detail-type: SuspiciousDocumentFlagged` events published by the `verify`
  Lambda, and forwards them to the `MediVerifySuspiciousAlerts` SNS topic.
- Subscribe an email/SMS/Lambda endpoint to that topic to receive live
  alerts (see `docs/DEPLOYMENT.md` step 3).
