"""
One-time / repeatable seed script that loads the original
backend/trusted_data.json medicine ledger into the DynamoDB
TrustedMedicines table created by the CDK stack.

Usage:
    pip install boto3
    python seed_trusted_medicines.py --table MediVerify-TrustedMedicines --region us-east-1

The table name and region are also printed as CDK stack outputs after
`cdk deploy` (see docs/DEPLOYMENT.md).
"""
import argparse
import json
import os

import boto3

DEFAULT_DATA_PATH = os.path.join(os.path.dirname(__file__), "..", "trusted_data.json")


def main():
    parser = argparse.ArgumentParser(description="Seed the MediVerify trusted-medicines DynamoDB table.")
    parser.add_argument("--table", required=True, help="DynamoDB table name (see CDK output 'TrustedTableName')")
    parser.add_argument("--region", default=os.environ.get("AWS_REGION", "us-east-1"))
    parser.add_argument("--data-file", default=DEFAULT_DATA_PATH, help="Path to trusted_data.json")
    args = parser.parse_args()

    with open(args.data_file, "r") as f:
        medicines = json.load(f)

    dynamodb = boto3.resource("dynamodb", region_name=args.region)
    table = dynamodb.Table(args.table)

    with table.batch_writer() as batch:
        for entry in medicines:
            batch.put_item(Item=entry)

    print(f"Seeded {len(medicines)} trusted medicine records into '{args.table}'.")


if __name__ == "__main__":
    main()
