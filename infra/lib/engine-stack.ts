import * as cdk from 'aws-cdk-lib';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as appscaling from 'aws-cdk-lib/aws-applicationautoscaling';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { StorageStack } from './storage-stack';

export interface EngineStackProps extends cdk.StackProps {
  storage: StorageStack;
}

export class EngineStack extends cdk.Stack {
  // Kept for one deploy cycle so AutoAwApi can drop its Fn::ImportValue before
  // we delete these exports. Remove in the next deploy.
  readonly jobQueue: sqs.Queue;
  readonly fargateService: ecs.FargateService;

  readonly cluster: ecs.Cluster;

  constructor(scope: Construct, id: string, props: EngineStackProps) {
    super(scope, id, props);

    const vpc = ec2.Vpc.fromLookup(this, 'Vpc', { isDefault: true });

    // ── KEPT: SQS (exported; AutoAwApi still imports queueUrl in current deploy) ──
    const dlq = new sqs.Queue(this, 'JobDlq', {
      queueName: 'autoaw-jobs-dlq',
      retentionPeriod: cdk.Duration.days(14),
    });
    this.jobQueue = new sqs.Queue(this, 'JobQueue', {
      queueName: 'autoaw-jobs',
      visibilityTimeout: cdk.Duration.hours(2),
      deadLetterQueue: { queue: dlq, maxReceiveCount: 3 },
    });

    this.cluster = new ecs.Cluster(this, 'Cluster', {
      vpc,
      clusterName: 'autoaw-engine',
      enableFargateCapacityProviders: true,
    });

    const engineRepo = ecr.Repository.fromRepositoryName(this, 'EngineRepo', 'autoaw-engine');

    const taskRole = new iam.Role(this, 'TaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      roleName: 'autoaw-engine-task-role',
    });
    props.storage.experimentsTable.grantReadWriteData(taskRole);
    props.storage.trialsTable.grantReadWriteData(taskRole);
    props.storage.evalRowsTable.grantReadWriteData(taskRole);
    props.storage.datasetsBucket.grantRead(taskRole);
    props.storage.snapshotsBucket.grantReadWrite(taskRole);
    this.jobQueue.grantConsumeMessages(taskRole);

    // ── KEPT: original task def + FargateService (exports must survive until
    //    AutoAwApi's Fn::ImportValue is removed in this same deploy) ───────────
    const oldTaskDef = new ecs.FargateTaskDefinition(this, 'EngineTaskDef', {
      cpu: 1024,
      memoryLimitMiB: 2048,
      taskRole,
      runtimePlatform: {
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        cpuArchitecture: ecs.CpuArchitecture.X86_64,
      },
    });
    oldTaskDef.addContainer('Engine', {
      image: ecs.ContainerImage.fromRegistry('public.ecr.aws/docker/library/python:3.12-slim'),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'autoaw-engine' }),
      environment: {
        EXPERIMENTS_TABLE: props.storage.experimentsTable.tableName,
        TRIALS_TABLE: props.storage.trialsTable.tableName,
        EVAL_ROWS_TABLE: props.storage.evalRowsTable.tableName,
        DATASETS_BUCKET: props.storage.datasetsBucket.bucketName,
        SNAPSHOTS_BUCKET: props.storage.snapshotsBucket.bucketName,
        JOB_QUEUE_URL: this.jobQueue.queueUrl,
      },
    });

    this.fargateService = new ecs.FargateService(this, 'EngineService', {
      cluster: this.cluster,
      taskDefinition: oldTaskDef,
      serviceName: 'autoaw-engine',
      desiredCount: 0,
      capacityProviderStrategies: [
        { capacityProvider: 'FARGATE_SPOT', weight: 4 },
        { capacityProvider: 'FARGATE', weight: 1 },
      ],
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      assignPublicIp: true,
      minHealthyPercent: 0,
      circuitBreaker: { rollback: true },
    });

    const scaling = this.fargateService.autoScaleTaskCount({ minCapacity: 0, maxCapacity: 4 });
    const queueDepth = new cloudwatch.Metric({
      namespace: 'AWS/SQS',
      metricName: 'ApproximateNumberOfMessagesVisible',
      dimensionsMap: { QueueName: this.jobQueue.queueName },
      statistic: 'Maximum',
      period: cdk.Duration.minutes(1),
    });
    scaling.scaleOnMetric('ScaleOnQueueDepth', {
      metric: queueDepth,
      scalingSteps: [
        { upper: 0, change: -4 },
        { lower: 1, change: +1 },
        { lower: 3, change: +2 },
      ],
      adjustmentType: appscaling.AdjustmentType.CHANGE_IN_CAPACITY,
      cooldown: cdk.Duration.minutes(2),
    });

    // ── NEW: explicit execution role with a fixed name so api-stack can
    //    reference the ARN directly without a cross-stack CloudFormation export ─
    const executionRole = new iam.Role(this, 'TaskExecutionRole', {
      roleName: 'autoaw-engine-execution-role',
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });

    // ── NEW: CloudWatch log group — must exist before any task tries to write ──
    const logGroup = new logs.LogGroup(this, 'EngineLogGroup', {
      logGroupName: '/ecs/autoaw-engine',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ── NEW: task definition with a fixed family name so Lambda can call
    //    RunTask with 'autoaw-engine' without knowing the CDK-generated ARN ────
    const runTaskDef = new ecs.FargateTaskDefinition(this, 'EngineRunTaskDef', {
      family: 'autoaw-engine',
      cpu: 1024,
      memoryLimitMiB: 2048,
      taskRole,
      executionRole,
      runtimePlatform: {
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        cpuArchitecture: ecs.CpuArchitecture.X86_64,
      },
    });
    runTaskDef.addContainer('Engine', {
      image: ecs.ContainerImage.fromEcrRepository(engineRepo, 'latest'),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'autoaw-engine', logGroup }),
      environment: {
        EXPERIMENTS_TABLE: props.storage.experimentsTable.tableName,
        TRIALS_TABLE: props.storage.trialsTable.tableName,
        EVAL_ROWS_TABLE: props.storage.evalRowsTable.tableName,
        DATASETS_BUCKET: props.storage.datasetsBucket.bucketName,
        SNAPSHOTS_BUCKET: props.storage.snapshotsBucket.bucketName,
        // EXPERIMENT_ID injected per-task via RunTask container override
      },
    });

    // ── NEW: security group for RunTask — outbound only ────────────────────────
    const taskSg = new ec2.SecurityGroup(this, 'TaskSg', {
      vpc,
      description: 'autoaw engine task',
      allowAllOutbound: true,
    });

    // Store SG ID in SSM so api-stack can use a CloudFormation dynamic reference
    // ({{resolve:ssm:...}}) instead of a cross-stack Fn::ImportValue.
    new ssm.StringParameter(this, 'TaskSgIdParam', {
      parameterName: '/autoaw/engine/task-sg-id',
      stringValue: taskSg.securityGroupId,
    });

    new cdk.CfnOutput(this, 'JobQueueUrl', {
      value: this.jobQueue.queueUrl,
      exportName: 'AutoAwJobQueueUrl',
    });
    new cdk.CfnOutput(this, 'EngineRepoUri', {
      value: engineRepo.repositoryUri,
      exportName: 'AutoAwEngineRepoUri',
    });
  }
}
