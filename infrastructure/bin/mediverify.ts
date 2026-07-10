#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { MediVerifyStack } from '../lib/mediverify-stack';

const app = new cdk.App();

new MediVerifyStack(app, 'MediVerifyStack', {
  description: 'MediVerify AI - AWS hackathon prototype (API Gateway + Lambda + Textract + Rekognition + DynamoDB + S3 + Cognito + Bedrock + EventBridge/SNS)',
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
  tags: {
    Project: 'MediVerify',
    Environment: 'hackathon',
  },
});
