import * as cdk from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { StorageStack } from './storage-stack';

export interface EngineStackProps extends cdk.StackProps {
  storage: StorageStack;
}

export class EngineStack extends cdk.Stack {
  readonly cluster: ecs.Cluster;
  readonly taskDefinition: ecs.FargateTaskDefinition;
  readonly taskSg: ec2.SecurityGroup;
  readonly executionRole: iam.Role;
  readonly vpcSubnetIds: string;
  readonly taskRoleArn: string;
  readonly executionRoleArn: string;

  constructor(scope: Construct, id: string, props: EngineStackProps) {
    super(scope, id, props);

    // Reuse the default VPC — public subnets with an Internet Gateway, no NAT cost.
    const vpc = ec2.Vpc.fromLookup(this, 'Vpc', { isDefault: true });

    // ECS cluster — Fargate only, Spot capacity enabled.
    this.cluster = new ecs.Cluster(this, 'Cluster', {
      vpc,
      clusterName: 'autoaw-engine',
      enableFargateCapacityProviders: true,
    });

    const engineRepo = ecr.Repository.fromRepositoryName(this, 'EngineRepo', 'autoaw-engine');

    // Task role — accesses DynamoDB, S3 during experiment execution.
    const taskRole = new iam.Role(this, 'TaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      roleName: 'autoaw-engine-task-role',
    });
    props.storage.experimentsTable.grantReadWriteData(taskRole);
    props.storage.trialsTable.grantReadWriteData(taskRole);
    props.storage.evalRowsTable.grantReadWriteData(taskRole);
    props.storage.datasetsBucket.grantRead(taskRole);
    props.storage.snapshotsBucket.grantReadWrite(taskRole);

    // Execution role — used by the ECS agent to pull images and write logs.
    this.executionRole = new iam.Role(this, 'TaskExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });

    // Explicit log group — ensures the group exists before any task tries to write.
    const logGroup = new logs.LogGroup(this, 'EngineLogGroup', {
      logGroupName: '/ecs/autoaw-engine',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Fargate task definition — fixed family name so the Lambda can reference it
    // without knowing the CDK-generated ARN revision.
    this.taskDefinition = new ecs.FargateTaskDefinition(this, 'EngineTaskDef', {
      family: 'autoaw-engine',
      cpu: 1024,
      memoryLimitMiB: 2048,
      taskRole,
      executionRole: this.executionRole,
      runtimePlatform: {
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        cpuArchitecture: ecs.CpuArchitecture.X86_64,
      },
    });

    this.taskDefinition.addContainer('Engine', {
      image: ecs.ContainerImage.fromEcrRepository(engineRepo, 'latest'),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'autoaw-engine', logGroup }),
      environment: {
        EXPERIMENTS_TABLE: props.storage.experimentsTable.tableName,
        TRIALS_TABLE: props.storage.trialsTable.tableName,
        EVAL_ROWS_TABLE: props.storage.evalRowsTable.tableName,
        DATASETS_BUCKET: props.storage.datasetsBucket.bucketName,
        SNAPSHOTS_BUCKET: props.storage.snapshotsBucket.bucketName,
        // EXPERIMENT_ID is injected per-task via RunTask container override.
      },
    });

    // Security group for tasks — outbound only (tasks reach AWS APIs via public IP).
    this.taskSg = new ec2.SecurityGroup(this, 'TaskSg', {
      vpc,
      description: 'autoaw engine task',
      allowAllOutbound: true,
    });

    this.vpcSubnetIds = vpc.publicSubnets.map(s => s.subnetId).join(',');
    this.taskRoleArn = taskRole.roleArn;
    this.executionRoleArn = this.executionRole.roleArn;

    new cdk.CfnOutput(this, 'EngineRepoUri', {
      value: engineRepo.repositoryUri,
      exportName: 'AutoAwEngineRepoUri',
    });
  }
}
