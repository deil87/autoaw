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
    // Nova models require cross-region inference profiles; grant both the
    // inference-profile ARN (home region) and foundation-model across all
    // routing regions so Bedrock can forward requests cross-region.
    const inferencePrefix: { [r: string]: string } = {
      'us-east-1': 'us', 'us-east-2': 'us', 'us-west-2': 'us',
      'eu-central-1': 'eu', 'eu-west-1': 'eu', 'eu-west-2': 'eu',
      'eu-west-3': 'eu', 'eu-north-1': 'eu',
      'ap-northeast-1': 'ap', 'ap-northeast-2': 'ap',
      'ap-southeast-1': 'ap', 'ap-southeast-2': 'ap', 'ap-south-1': 'ap',
    };
    const novaPrefix = inferencePrefix[this.region] ?? 'us';
    const novaModels = ['amazon.nova-micro-v1:0', 'amazon.nova-lite-v1:0'];
    taskRole.addToPolicy(new iam.PolicyStatement({
      actions: ['bedrock:Converse', 'bedrock:InvokeModel'],
      resources: [
        ...novaModels.map(m => `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/${novaPrefix}.${m}`),
        ...novaModels.map(m => `arn:aws:bedrock:*::foundation-model/${m}`),
        `arn:aws:bedrock:${this.region}::foundation-model/meta.llama3-2-1b-instruct-v1:0`,
        `arn:aws:bedrock:${this.region}::foundation-model/meta.llama3-2-3b-instruct-v1:0`,
        `arn:aws:bedrock:${this.region}::foundation-model/meta.llama3-1-8b-instruct-v1:0`,
      ],
    }));

    const executionRole = new iam.Role(this, 'TaskExecutionRole', {
      roleName: 'autoaw-engine-execution-role',
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });
    // Allow the execution role to pull the OpenAI key from SSM at task start
    executionRole.addToPolicy(new iam.PolicyStatement({
      actions: ['ssm:GetParameters'],
      resources: [
        `arn:aws:ssm:${this.region}:${this.account}:parameter/autoaw/engine/OPENAI_API_KEY`,
      ],
    }));

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
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
      },
    });
    const openAiKeySecret = ecs.Secret.fromSsmParameter(
      ssm.StringParameter.fromSecureStringParameterAttributes(this, 'OpenAiKeyParam', {
        parameterName: '/autoaw/engine/OPENAI_API_KEY',
      })
    );

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
      secrets: {
        OPENAI_API_KEY: openAiKeySecret,
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
