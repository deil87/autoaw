import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';

/**
 * Standalone stack that provisions a GitHub Actions OIDC role for autoaw.
 * Deploy once: cd infra && npx cdk deploy AutoAw-GitHubActions
 * The role ARN is output and should be stored as AWS_DEPLOY_ROLE_ARN in GitHub secrets.
 */
export class GitHubActionsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Reuse the existing OIDC provider (one per account, created by straid infra)
    const oidcProvider = iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
      this,
      'GitHubOidc',
      `arn:aws:iam::${this.account}:oidc-provider/token.actions.githubusercontent.com`,
    );

    const role = new iam.Role(this, 'GitHubActionsRole', {
      roleName: 'autoaw-GitHubActionsRole',
      assumedBy: new iam.WebIdentityPrincipal(oidcProvider.openIdConnectProviderArn, {
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
        },
        StringLike: {
          'token.actions.githubusercontent.com:sub': 'repo:deil87/autoaw:*',
        },
      }),
      description: 'Role assumed by GitHub Actions to deploy autoaw via CDK',
      maxSessionDuration: cdk.Duration.hours(2),
    });

    role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AdministratorAccess'));

    new cdk.CfnOutput(this, 'RoleArn', {
      value: role.roleArn,
      description: 'Set this as AWS_DEPLOY_ROLE_ARN in GitHub Actions secrets',
    });
  }
}
