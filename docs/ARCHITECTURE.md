# MediVerify AI — AWS Architecture

## System Diagram

```mermaid
flowchart TD
    subgraph Client["React + TypeScript + Vite Frontend (Capacitor / Android)"]
        UI[MediVerify App UI]
    end

    subgraph Auth["Amazon Cognito"]
        UP[User Pool]
    end

    subgraph Edge["Amazon API Gateway (REST API)"]
        GW[/verify · /flagged · /chat/]
    end

    subgraph Compute["AWS Lambda (Python 3.12)"]
        VF[verify function]
        FF[flagged function]
        CF[chat function]
        LY[[Shared Lambda Layer:\nresponses.py, multipart_form.py]]
    end

    subgraph AI["AWS AI Services"]
        TX[Amazon Textract\nOCR]
        RK[Amazon Rekognition\nImage labels/quality]
        BR[Amazon Bedrock\nClaude Haiku]
    end

    subgraph Data["Storage"]
        S3[(Amazon S3\nUploaded Documents)]
        DDB1[(DynamoDB\nTrustedMedicines)]
        DDB2[(DynamoDB\nFlaggedEntries)]
    end

    subgraph Events["Event-Driven Alerting"]
        EB[[EventBridge Bus\nmediverify-events]]
        SNS[(SNS Topic\nSuspiciousAlerts)]
    end

    subgraph Obs["Observability"]
        CW[(CloudWatch Logs & Metrics)]
    end

    UI -- "Sign up / Sign in" --> UP
    UI -- "Upload image / GET ledger / chat" --> GW
    GW --> VF
    GW --> FF
    GW --> CF

    VF -.uses.-> LY
    FF -.uses.-> LY
    CF -.uses.-> LY

    VF --> S3
    VF --> TX
    VF --> RK
    VF --> DDB1
    VF -- "on suspicious result" --> DDB2
    VF -- "publish event" --> EB
    EB --> SNS

    FF --> DDB2
    CF --> BR

    VF --> CW
    FF --> CW
    CF --> CW
```

## Data Flow — Document Verification (`POST /verify`)

```mermaid
sequenceDiagram
    participant U as User (App)
    participant GW as API Gateway
    participant L as verify Lambda
    participant S3 as S3 Bucket
    participant TX as Textract
    participant RK as Rekognition
    participant DDB as DynamoDB (Trusted)
    participant FLG as DynamoDB (Flagged)
    participant EB as EventBridge
    participant SNS as SNS Topic

    U->>GW: POST /verify (multipart image)
    GW->>L: invoke(event)
    L->>S3: put_object(image)
    L->>TX: DetectDocumentText(image)
    TX-->>L: raw OCR text
    L->>RK: DetectLabels(image)
    RK-->>L: labels + confidence
    L->>L: regex-extract batch number + medicine name
    L->>DDB: get_item(batch_number)
    DDB-->>L: trusted entry (or none)
    alt Suspicious / unmatched
        L->>FLG: put_item(flagged entry)
        L->>EB: put_events(SuspiciousDocumentFlagged)
        EB->>SNS: publish notification
    end
    L-->>GW: JSON verification result
    GW-->>U: 200 OK (status, score, flags)
```

## Why Each Service Was Chosen

| Service | Role | Rationale |
|---|---|---|
| **API Gateway** | Public HTTPS entrypoint | Managed, scales automatically, pairs naturally with Lambda; keeps the exact same `/verify`, `/flagged` contract the frontend already expects, plus new `/chat` |
| **Lambda** | Compute for all 3 routes | No servers to patch/manage — ideal for a time-boxed hackathon prototype; scales to zero between demos |
| **Amazon Textract** | OCR | Purpose-built for document text extraction; far more reliable than a local Tesseract binary dependency, and removes an OS-level dependency from the deployment entirely |
| **Amazon Rekognition** | Image signal | Adds a real (if lightweight) image-quality signal into the authenticity score, replacing a portion of the previous fully-random score |
| **DynamoDB** | Trusted ledger + audit log | Serverless, single-digit-millisecond lookups by `batch_number`; replaces two local JSON files with a durable, queryable store |
| **S3** | Uploaded document storage | Durable audit trail of every submitted image, referenced by key in verification results |
| **Cognito** | Authentication | Real user pool with email verification, replacing the localStorage-only mock login while keeping the same screens |
| **Bedrock** | Chat assistant | Powers the existing "Security Response Desk" panel with a real LLM (Claude Haiku) instead of hardcoded string matching |
| **EventBridge + SNS** | Suspicious-document alerting | Demonstrates event-driven architecture: a flagged scan fires an event that fans out to a notification topic, decoupled from the verify Lambda's request/response cycle |
| **CloudWatch** | Logs & metrics | Automatic per-Lambda log groups (1-week retention) plus API Gateway execution metrics, no extra code required |

**Comprehend and SQS were intentionally not used** — there's no unstructured-text-classification need beyond the existing regex/Textract pipeline, and the request volume/pattern doesn't call for a queue between synchronous API calls.
