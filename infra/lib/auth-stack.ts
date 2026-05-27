import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as path from 'path';
import { Construct } from 'constructs';

export class AuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ── User Pool ─────────────────────────────────────────────────────────────
    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: 'autoaw-users',
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: false },
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      userVerification: {
        emailSubject: 'Verify your AutoAW account',
        emailBody: 'Your AutoAW verification code is {####}',
        emailStyle: cognito.VerificationEmailStyle.CODE,
      },
    });

    // ── Google IdP ────────────────────────────────────────────────────────────
    const googleClientId = ssm.StringParameter.valueForStringParameter(
      this, '/autoaw/GoogleClientId'
    );
    const googleClientSecret = ssm.StringParameter.valueForStringParameter(
      this, '/autoaw/GoogleClientSecret'
    );

    const googleIdp = new cognito.CfnUserPoolIdentityProvider(this, 'GoogleIdP', {
      userPoolId: this.userPool.userPoolId,
      providerName: 'Google',
      providerType: 'Google',
      providerDetails: {
        client_id: googleClientId,
        client_secret: googleClientSecret,
        authorize_scopes: 'email profile openid',
      },
      attributeMapping: { email: 'email', name: 'name' },
    });

    // ── App Client — L2 base + L1 escape hatch for full OAuth control ─────────
    this.userPoolClient = this.userPool.addClient('WebClient', {
      userPoolClientName: 'autoaw-web',
      authFlows: { userSrp: true },
      generateSecret: false,
      preventUserExistenceErrors: true,
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.PROFILE,
          cognito.OAuthScope.OPENID,
        ],
        callbackUrls: ['https://autoaw.app/login', 'http://localhost:3032/login'],
        logoutUrls:   ['https://autoaw.app/', 'http://localhost:3032/'],
      },
      supportedIdentityProviders: [
        cognito.UserPoolClientIdentityProvider.COGNITO,
        cognito.UserPoolClientIdentityProvider.GOOGLE,
      ],
    });
    this.userPoolClient.node.addDependency(googleIdp);

    // ── Cognito Hosted UI domain ───────────────────────────────────────────────
    new cognito.CfnUserPoolDomain(this, 'Domain', {
      domain: 'autoaw-auth',
      userPoolId: this.userPool.userPoolId,
    });

    // ── Pre-signup trigger: links Google + email/password accounts ────────────
    const preSignupFn = new lambda.Function(this, 'PreSignupHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/pre-signup')),
      logRetention: logs.RetentionDays.THREE_DAYS,
    });
    // '*' avoids a circular CFn dependency: Lambda policy → user pool ARN → trigger → Lambda
    preSignupFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['cognito-idp:ListUsers', 'cognito-idp:AdminLinkProviderForUser'],
      resources: ['*'],
    }));
    this.userPool.addTrigger(cognito.UserPoolOperation.PRE_SIGN_UP, preSignupFn);

    // ── SSM export: User Pool ID for cross-stack use without Fn::ImportValue ──
    new ssm.StringParameter(this, 'UserPoolIdParam', {
      parameterName: '/autoaw/CognitoUserPoolId',
      stringValue: this.userPool.userPoolId,
    });

    // ── CloudFormation outputs ────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      description: 'Cognito User Pool ID',
    });
    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      description: 'Cognito User Pool App Client ID',
    });
    new cdk.CfnOutput(this, 'CognitoDomain', {
      value: `autoaw-auth.auth.${this.region}.amazoncognito.com`,
      description: 'Cognito Hosted UI domain',
    });
  }
}
