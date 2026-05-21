import * as cdk from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { StorageStack } from './storage-stack';

export interface EngineStackProps extends cdk.StackProps {
  storage: StorageStack;
}

export class EngineStack extends cdk.Stack {
  readonly cluster: ecs.Cluster;

  constructor(scope: Construct, id: string, props: EngineStackProps) {
    super(scope, id, props);

    const vpc = ec2.Vpc.fromLookup(this, 'Vpc', { isDefault: true });

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

    const executionRole = new iam.Role(this, 'TaskExecutionRole', {
      roleName: 'autoaw-engine-execution-role',
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });

    const logGroup = new logs.LogGroup(this, 'EngineLogGroup', {
      logGroupName: '/ecs/autoaw-engine',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

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

    const taskSg = new ec2.SecurityGroup(this, 'TaskSg', {
      vpc,
      description: 'autoaw engine task',
      allowAllOutbound: true,
    });

    new ssm.StringParameter(this, 'TaskSgIdParam', {
      parameterName: '/autoaw/engine/task-sg-id',
      stringValue: taskSg.securityGroupId,
    });

    new cdk.CfnOutput(this, 'EngineRepoUri', {
      value: engineRepo.repositoryUri,
      exportName: 'AutoAwEngineRepoUri',
    });
  }
}
