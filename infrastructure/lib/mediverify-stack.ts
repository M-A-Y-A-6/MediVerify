import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';

/**
 * MediVerify AI - AWS Hackathon Prototype Stack
 *
 * Services used and why:
 *  - S3            : durable storage for uploaded document images (audit trail)
 *  - DynamoDB      : trusted-medicines ledger + flagged/suspicious audit log
 *  - Lambda        : serverless compute for verify / flagged / chat routes
 *  - API Gateway   : public HTTPS surface for the React frontend
 *  - Textract      : OCR of prescription/medicine document images
 *  - Rekognition   : supporting image-quality/label signal for the score
 *  - Cognito       : real user authentication (replaces localStorage mock)
 *  - Bedrock       : LLM-powered chat assistant (invoked directly from the
 *                    chat Lambda via IAM permissions, no dedicated CDK
 *                    construct needed for model invocation)
 *  - EventBridge   : custom bus + rule that reacts to suspicious scans
 *  - SNS           : notification target subscribed to the EventBridge rule
 *  - CloudWatch    : automatic Lambda logging + log retention policy
 */
export class MediVerifyStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ---------------------------------------------------------------------
    // S3 - uploaded document storage
    // ---------------------------------------------------------------------
    const uploadBucket = new s3.Bucket(this, 'MediVerifyUploadsBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY, // prototype: ok to tear down with the stack
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT, s3.HttpMethods.POST],
          allowedOrigins: ['*'],
          allowedHeaders: ['*'],
        },
      ],
    });

    // ---------------------------------------------------------------------
    // DynamoDB - trusted ledger + flagged/audit log
    // ---------------------------------------------------------------------
    const trustedTable = new dynamodb.Table(this, 'TrustedMedicinesTable', {
      tableName: 'MediVerify-TrustedMedicines',
      partitionKey: { name: 'batch_number', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const flaggedTable = new dynamodb.Table(this, 'FlaggedEntriesTable', {
      tableName: 'MediVerify-FlaggedEntries',
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ---------------------------------------------------------------------
    // Cognito - real user authentication
    // ---------------------------------------------------------------------
    const userPool = new cognito.UserPool(this, 'MediVerifyUserPool', {
      userPoolName: 'mediverify-users',
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        fullname: { required: false, mutable: true },
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: false,
        requireDigits: true,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const userPoolClient = new cognito.UserPoolClient(this, 'MediVerifyUserPoolClient', {
      userPool,
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      generateSecret: false, // required for browser-based SPA usage
    });

    // ---------------------------------------------------------------------
    // EventBridge + SNS - suspicious document alerting
    // ---------------------------------------------------------------------
    const alertTopic = new sns.Topic(this, 'MediVerifySuspiciousAlerts', {
      displayName: 'MediVerify Suspicious Document Alerts',
    });

    const eventBus = new events.EventBus(this, 'MediVerifyEventBus', {
      eventBusName: 'mediverify-events',
    });

    new events.Rule(this, 'SuspiciousDocumentRule', {
      eventBus,
      description: 'Routes SuspiciousDocumentFlagged events to the alert SNS topic',
      eventPattern: {
        source: ['mediverify.backend'],
        detailType: ['SuspiciousDocumentFlagged'],
      },
      targets: [new targets.SnsTopic(alertTopic)],
    });

    // ---------------------------------------------------------------------
    // Lambda Layer - shared helper code (responses.py, multipart_form.py)
    // used by all three functions. Keeps handler.py files small and
    // avoids duplicating the CORS/JSON-response boilerplate three times.
    // ---------------------------------------------------------------------
    const commonLayer = new lambda.LayerVersion(this, 'MediVerifyCommonLayer', {
      layerVersionName: 'mediverify-common',
      code: lambda.Code.fromAsset('../backend/lambda/common-layer'),
      compatibleRuntimes: [lambda.Runtime.PYTHON_3_12],
      description: 'Shared response/CORS helpers and multipart form parser for MediVerify Lambdas',
    });

    // ---------------------------------------------------------------------
    // Lambda functions
    // ---------------------------------------------------------------------
    const commonEnv = {
      TRUSTED_TABLE: trustedTable.tableName,
      FLAGGED_TABLE: flaggedTable.tableName,
      UPLOAD_BUCKET: uploadBucket.bucketName,
      EVENT_BUS_NAME: eventBus.eventBusName,
      BEDROCK_MODEL_ID: 'anthropic.claude-3-haiku-20240307-v1:0',
    };

    const verifyFn = new lambda.Function(this, 'VerifyFunction', {
      functionName: 'mediverify-verify',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'handler.lambda_handler',
      code: lambda.Code.fromAsset('../backend/lambda/verify'),
      layers: [commonLayer],
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: commonEnv,
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    const flaggedFn = new lambda.Function(this, 'FlaggedFunction', {
      functionName: 'mediverify-flagged',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'handler.lambda_handler',
      code: lambda.Code.fromAsset('../backend/lambda/flagged'),
      layers: [commonLayer],
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      environment: commonEnv,
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    const chatFn = new lambda.Function(this, 'ChatFunction', {
      functionName: 'mediverify-chat',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'handler.lambda_handler',
      code: lambda.Code.fromAsset('../backend/lambda/chat'),
      layers: [commonLayer],
      timeout: cdk.Duration.seconds(20),
      memorySize: 256,
      environment: commonEnv,
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // ---------------------------------------------------------------------
    // IAM permissions (least-privilege per function)
    // ---------------------------------------------------------------------
    trustedTable.grantReadData(verifyFn);
    flaggedTable.grantReadWriteData(verifyFn);
    flaggedTable.grantReadData(flaggedFn);
    uploadBucket.grantReadWrite(verifyFn);
    eventBus.grantPutEventsTo(verifyFn);

    verifyFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['textract:DetectDocumentText', 'textract:AnalyzeDocument'],
        resources: ['*'], // Textract does not support resource-level permissions
      })
    );

    verifyFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['rekognition:DetectLabels', 'rekognition:DetectModerationLabels'],
        resources: ['*'], // Rekognition does not support resource-level permissions
      })
    );

    chatFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: ['*'], // scope to specific model ARNs in production
      })
    );

    // ---------------------------------------------------------------------
    // API Gateway
    // ---------------------------------------------------------------------
    const api = new apigateway.RestApi(this, 'MediVerifyApi', {
      restApiName: 'MediVerify API',
      description: 'MediVerify AI hackathon prototype API',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
      },
      binaryMediaTypes: ['multipart/form-data', 'image/*'],
      deployOptions: {
        stageName: 'prod',
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        metricsEnabled: true,
      },
    });

    api.root.addResource('verify').addMethod('POST', new apigateway.LambdaIntegration(verifyFn));
    api.root.addResource('flagged').addMethod('GET', new apigateway.LambdaIntegration(flaggedFn));
    api.root.addResource('chat').addMethod('POST', new apigateway.LambdaIntegration(chatFn));

    // ---------------------------------------------------------------------
    // Outputs - copy these into frontend/.env (see docs/DEPLOYMENT.md)
    // ---------------------------------------------------------------------
    new cdk.CfnOutput(this, 'ApiUrl', { value: api.url, description: 'VITE_API_URL' });
    new cdk.CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId, description: 'VITE_COGNITO_USER_POOL_ID' });
    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: userPoolClient.userPoolClientId,
      description: 'VITE_COGNITO_CLIENT_ID',
    });
    new cdk.CfnOutput(this, 'UploadBucketName', { value: uploadBucket.bucketName });
    new cdk.CfnOutput(this, 'TrustedTableName', { value: trustedTable.tableName, description: 'used by seed script' });
    new cdk.CfnOutput(this, 'FlaggedTableName', { value: flaggedTable.tableName });
    new cdk.CfnOutput(this, 'AlertTopicArn', { value: alertTopic.topicArn });
  }
}
