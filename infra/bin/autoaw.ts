#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { StorageStack } from '../lib/storage-stack';
import { EngineStack } from '../lib/engine-stack';
import { ApiStack } from '../lib/api-stack';

const app = new cdk.App();

const env: cdk.Environment = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'eu-central-1',
};

const storage = new StorageStack(app, 'AutoAwStorage', { env });
const engine = new EngineStack(app, 'AutoAwEngine', { env, storage });
new ApiStack(app, 'AutoAwApi', { env, storage, engine });

import { FrontendStack } from '../lib/frontend-stack';
new FrontendStack(app, 'AutoAwFrontend', { env });
