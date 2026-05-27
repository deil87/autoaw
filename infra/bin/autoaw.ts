#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { StorageStack } from '../lib/storage-stack';
import { EngineStack } from '../lib/engine-stack';
import { ApiStack } from '../lib/api-stack';
import { FrontendStack } from '../lib/frontend-stack';
import { CertificateStack } from '../lib/certificate-stack';
import { GitHubActionsStack } from '../lib/github-actions-stack';
import { AuthStack } from '../lib/auth-stack';

const app = new cdk.App();

const env: cdk.Environment = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'eu-central-1',
};

new AuthStack(app, 'AutoAwAuth', { env });

const storage = new StorageStack(app, 'AutoAwStorage', { env });
const engine = new EngineStack(app, 'AutoAwEngine', { env, storage });
// Explicit ordering: engine must deploy before api so the SSM param
// /autoaw/engine/task-sg-id exists when CloudFormation resolves it.
const api = new ApiStack(app, 'AutoAwApi', { env, storage, engine });
api.addDependency(engine);

const certStack = new CertificateStack(app, 'AutoAwCertificate', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'us-east-1' },
  crossRegionReferences: true,
});
const frontendStack = new FrontendStack(app, 'AutoAwFrontend', {
  env,
  certificate: certStack.certificate,
  crossRegionReferences: true,
});
frontendStack.addDependency(certStack);

new GitHubActionsStack(app, 'AutoAw-GitHubActions', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'eu-central-1' },
});
