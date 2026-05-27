import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
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
      handler: 'backend.api.lambda_handler.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../../backend'), {
        bundling: {
          image: lambda.Runtime.PYTHON_3_12.bundlingImage,
          command: [
            'bash', '-c',
            'pip install -r /asset-input/api/requirements.txt -t /asset-output && cp -r /asset-input /asset-output/backend',
          ],
        },
      }),
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        EXPERIMENTS_TABLE: props.storage.experimentsTable.tableName,
        TRIALS_TABLE: props.storage.trialsTable.tableName,
        EVAL_ROWS_TABLE: props.storage.evalRowsTable.tableName,
        DATASETS_BUCKET: props.storage.datasetsBucket.bucketName,
        STORE_BACKEND: 'dynamo',
        // These names are set explicitly in engine-stack so they never change,
        // allowing us to hardcode them here and avoid cross-stack Fn::ImportValue.
        ECS_CLUSTER_NAME: 'autoaw-engine',
        ECS_TASK_DEF: 'autoaw-engine',
        // SG ID is CloudFormation-generated; engine-stack writes it to SSM so we
        // can use a dynamic reference ({{resolve:ssm:...}}) with no cross-stack export.
        ECS_TASK_SG_ID: ssm.StringParameter.valueForStringParameter(this, '/autoaw/engine/task-sg-id'),
        // Subnet IDs from the default VPC in eu-central-1 (matches cdk.context.json).
        ECS_SUBNET_IDS: 'subnet-093e4d4acd65d78d6,subnet-05a4cb04f08c633a3,subnet-086f54fee1c6e523d',
        RESEND_API_KEY: process.env.RESEND_API_KEY ?? '',
        DEMO_FROM_EMAIL: 'AutoAW <noreply@optimetrics.ai>',
        DEMO_TO_EMAIL: 'spirtik87@gmail.com',
        DEMO_REQUESTS_TABLE: props.storage.demoRequestsTable.tableName,
        COGNITO_USER_POOL_ID: ssm.StringParameter.valueForStringParameter(this, '/autoaw/CognitoUserPoolId'),
        ADMIN_EMAIL: 'spirtik87@gmail.com',
      },
    });

    fn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ecs:ListTasks', 'ecs:DescribeTasks', 'ecs:StopTask'],
      resources: ['*'],
    }));
    fn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ecs:RunTask'],
      // Wildcard revision — Lambda always runs the latest registered revision.
      resources: [`arn:aws:ecs:${this.region}:${this.account}:task-definition/autoaw-engine:*`],
    }));
    fn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['iam:PassRole'],
      // Fixed role names set in engine-stack — no Fn::ImportValue needed.
      resources: [
        `arn:aws:iam::${this.account}:role/autoaw-engine-task-role`,
        `arn:aws:iam::${this.account}:role/autoaw-engine-execution-role`,
      ],
    }));

    props.storage.experimentsTable.grantReadWriteData(fn);
    props.storage.trialsTable.grantReadWriteData(fn);
    props.storage.evalRowsTable.grantReadWriteData(fn);
    props.storage.datasetsBucket.grantReadWrite(fn);
    props.storage.demoRequestsTable.grantReadWriteData(fn);

    fn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['cognito-idp:AdminCreateUser'],
      resources: [`arn:aws:cognito-idp:${this.region}:${this.account}:userpool/*`],
    }));

    // HTTP API — pay-per-request, no idle cost
    const api = new apigwv2.HttpApi(this, 'HttpApi', {
      apiName: 'autoaw-api',
      corsPreflight: {
        allowOrigins: ['*'],
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
