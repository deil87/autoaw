import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export class StorageStack extends cdk.Stack {
  readonly experimentsTable: dynamodb.Table;
  readonly trialsTable: dynamodb.Table;
  readonly evalRowsTable: dynamodb.Table;
  readonly demoRequestsTable: dynamodb.Table;
  readonly datasetsBucket: s3.Bucket;
  readonly snapshotsBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);

    // experiments — stream enabled for future WebSocket push
    this.experimentsTable = new dynamodb.Table(this, 'Experiments', {
      tableName: 'autoaw-experiments',
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      stream: dynamodb.StreamViewType.NEW_IMAGE,
    });

    // trials — GSI on experiment_id for per-experiment queries
    this.trialsTable = new dynamodb.Table(this, 'Trials', {
      tableName: 'autoaw-trials',
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    this.trialsTable.addGlobalSecondaryIndex({
      indexName: 'experiment-id-index',
      partitionKey: { name: 'experiment_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'created_at', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // eval_rows — GSI on trial_id
    this.evalRowsTable = new dynamodb.Table(this, 'EvalRows', {
      tableName: 'autoaw-eval-rows',
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    this.evalRowsTable.addGlobalSecondaryIndex({
      indexName: 'trial-id-index',
      partitionKey: { name: 'trial_id', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // demo_requests — invite management
    this.demoRequestsTable = new dynamodb.Table(this, 'DemoRequests', {
      tableName: 'autoaw-demo-requests',
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Datasets bucket — CORS for presigned PUT uploads from the browser
    this.datasetsBucket = new s3.Bucket(this, 'Datasets', {
      bucketName: `autoaw-datasets-${this.account}`,
      versioned: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT],
          allowedOrigins: ['*'], // tighten to frontend domain in production
          allowedHeaders: ['*'],
          maxAge: 3000,
        },
      ],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Snapshots bucket — gene checkpoints written by the Fargate worker
    this.snapshotsBucket = new s3.Bucket(this, 'Snapshots', {
      bucketName: `autoaw-snapshots-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
  }
}
