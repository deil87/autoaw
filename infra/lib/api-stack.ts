import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as path from 'path';
import { Construct } from 'constructs';
import { StorageStack } from './storage-stack';
import { EngineStack } from './engine-stack';

export interface ApiStackProps extends cdk.StackProps {
  storage: StorageStack;
  engine: EngineStack;
}

export class ApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    // Python 3.12 Lambda wrapping the existing FastAPI app via Mangum
    const fn = new lambda.Function(this, 'ApiHandler', {
      functionName: 'autoaw-api',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'lambda_handler.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../../backend/api')),
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        EXPERIMENTS_TABLE: props.storage.experimentsTable.tableName,
        TRIALS_TABLE: props.storage.trialsTable.tableName,
        EVAL_ROWS_TABLE: props.storage.evalRowsTable.tableName,
        DATASETS_BUCKET: props.storage.datasetsBucket.bucketName,
        JOB_QUEUE_URL: props.engine.jobQueue.queueUrl,
        STORE_BACKEND: 'dynamo',
      },
    });

    props.storage.experimentsTable.grantReadWriteData(fn);
    props.storage.trialsTable.grantReadWriteData(fn);
    props.storage.evalRowsTable.grantReadWriteData(fn);
    props.storage.datasetsBucket.grantReadWrite(fn);
    props.engine.jobQueue.grantSendMessages(fn);

    // HTTP API — pay-per-request, no idle cost
    const api = new apigwv2.HttpApi(this, 'HttpApi', {
      apiName: 'autoaw-api',
      corsPreflight: {
        allowOrigins: ['http://localhost:3000', 'http://localhost:3032', 'https://d32ilmniiyvkjt.cloudfront.net'],
        allowMethods: [apigwv2.CorsHttpMethod.ANY],
        allowHeaders: ['content-type', 'authorization'],
        maxAge: cdk.Duration.days(1),
      },
    });

    api.addRoutes({
      path: '/{proxy+}',
      methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.POST, apigwv2.HttpMethod.PUT, apigwv2.HttpMethod.PATCH, apigwv2.HttpMethod.DELETE],
      integration: new integrations.HttpLambdaIntegration('LambdaIntegration', fn),
    });

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.apiEndpoint,
      exportName: 'AutoAwApiUrl',
    });
  }
}
