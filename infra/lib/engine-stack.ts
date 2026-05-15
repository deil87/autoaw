import * as cdk from 'aws-cdk-lib';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as appscaling from 'aws-cdk-lib/aws-applicationautoscaling';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { Construct } from 'constructs';
import { StorageStack } from './storage-stack';

export interface EngineStackProps extends cdk.StackProps {
  storage: StorageStack;
}

export class EngineStack extends cdk.Stack {
  readonly jobQueue: sqs.Queue;
  readonly fargateService: ecs.FargateService;
  readonly cluster: ecs.Cluster;

  constructor(scope: Construct, id: string, props: EngineStackProps) {
    super(scope, id, props);

    // Reuse the default VPC to avoid hitting the 5-VPC-per-region account limit.
    // The default VPC has public subnets in each AZ with an Internet Gateway,
    // so Fargate tasks can reach the internet with a public IP and no NAT cost.
    const vpc = ec2.Vpc.fromLookup(this, 'Vpc', { isDefault: true });

    // Default VPC has an Internet Gateway — Fargate tasks with public IPs reach AWS services directly.

    // Dead-letter queue — captures jobs that fail 3 times
    const dlq = new sqs.Queue(this, 'JobDlq', {
      queueName: 'autoaw-jobs-dlq',
      retentionPeriod: cdk.Duration.days(14),
    });

    // Main job queue — visibility timeout must exceed the longest expected GP run
    this.jobQueue = new sqs.Queue(this, 'JobQueue', {
      queueName: 'autoaw-jobs',
      visibilityTimeout: cdk.Duration.hours(2),
      deadLetterQueue: { queue: dlq, maxReceiveCount: 3 },
    });

    // ECS cluster — Fargate only, Spot capacity enabled
    this.cluster = new ecs.Cluster(this, 'Cluster', {
      vpc,
      clusterName: 'autoaw-engine',
      enableFargateCapacityProviders: true,
    });

    // Import the existing ECR repository (orphaned from a previous partial deploy).
    // Cannot recreate because amplify-policy lacks ecr:DeleteRepository.
    const engineRepo = ecr.Repository.fromRepositoryName(this, 'EngineRepo', 'autoaw-engine');

    // Task IAM role — principle of least privilege
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

    // Fargate task definition — 1 vCPU / 2 GB is sufficient for threaded GP
    const taskDef = new ecs.FargateTaskDefinition(this, 'EngineTaskDef', {
      cpu: 1024,
      memoryLimitMiB: 2048,
      taskRole,
      runtimePlatform: {
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        cpuArchitecture: ecs.CpuArchitecture.X86_64,
      },
    });

    taskDef.addContainer('Engine', {
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

    // Fargate service — start at 0, scale up when jobs arrive.
    // FARGATE_SPOT (4) + FARGATE (1) fallback gives ~70% cost reduction.
    this.fargateService = new ecs.FargateService(this, 'EngineService', {
      cluster: this.cluster,
      taskDefinition: taskDef,
      serviceName: 'autoaw-engine',
      desiredCount: 0,
      capacityProviderStrategies: [
        { capacityProvider: 'FARGATE_SPOT', weight: 4 },
        { capacityProvider: 'FARGATE', weight: 1 },
      ],
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      assignPublicIp: true, // required when there is no NAT gateway
      minHealthyPercent: 0,  // allow scale-to-zero without deployment blockage
      circuitBreaker: { rollback: true },  // fast failure detection
    });

    // Application Auto Scaling — scale task count based on SQS queue depth
    const scaling = this.fargateService.autoScaleTaskCount({
      minCapacity: 0,
      maxCapacity: 4,
    });

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
        { upper: 0, change: -4 },   // queue empty → drain to 0
        { lower: 1, change: +1 },   // 1 job → +1 task
        { lower: 3, change: +2 },   // 3 jobs → +2 more tasks
      ],
      adjustmentType: appscaling.AdjustmentType.CHANGE_IN_CAPACITY,
      cooldown: cdk.Duration.minutes(2),
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
