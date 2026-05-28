import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { Construct } from 'constructs';

interface FrontendStackProps extends cdk.StackProps {
  certificate?: acm.ICertificate;
}

export class FrontendStack extends cdk.Stack {
  public readonly siteBucketName: string;

  constructor(scope: Construct, id: string, props?: FrontendStackProps) {
    super(scope, id, props);

    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const s3Origin = new origins.S3Origin(siteBucket);

    // Rewrites dynamic experiment/trial IDs to the _ placeholder files
    // that Next.js static export generates, and appends .html so S3 finds them.
    const urlRewrite = new cloudfront.Function(this, 'UrlRewrite', {
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  var host = request.headers.host && request.headers.host.value;
  if (host === 'www.autoaw.app') {
    var qs = request.querystring ? '?' + request.querystring : '';
    return {
      statusCode: 301,
      statusDescription: 'Moved Permanently',
      headers: { location: { value: 'https://autoaw.app' + request.uri + qs } }
    };
  }
  var uri = request.uri;
  if (uri.length > 1 && uri.charAt(uri.length - 1) === '/') {
    uri = uri.slice(0, -1);
  }
  var mExp = uri.match(/^\\/experiments\\/([^\\/]+)(\\/.*)?$/);
  if (mExp && mExp[1] !== 'new' && mExp[1] !== '_') {
    var rest = mExp[2] || '';
    var mTrial = rest.match(/^\\/trial\\/([^\\/]+)(\\/.*)?$/);
    if (mTrial && mTrial[1] !== '_') {
      rest = '/trial/_' + (mTrial[2] || '');
    }
    uri = '/experiments/_' + rest;
  }
  if (uri !== '/' && uri.lastIndexOf('.') <= uri.lastIndexOf('/')) {
    uri = uri + '.html';
  }
  request.uri = uri;
  return request;
}
      `),
      runtime: cloudfront.FunctionRuntime.JS_2_0,
    });

    // V2: fresh distribution (forces new CloudFront URL)
    const distribution = new cloudfront.Distribution(this, 'SiteDistributionV2', {
      ...(props?.certificate ? {
        certificate: props.certificate,
        domainNames: ['autoaw.app', 'www.autoaw.app'],
      } : {}),
      defaultBehavior: {
        origin: s3Origin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        // HTML files — no CloudFront caching; let browser revalidate via no-cache from S3
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        functionAssociations: [{
          function: urlRewrite,
          eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
        }],
      },
      additionalBehaviors: {
        '/_next/static/*': {
          origin: s3Origin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          // Content-hashed assets — safe to cache forever at the edge
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        },
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        },
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        },
      ],
    });

    this.siteBucketName = siteBucket.bucketName;

    new cdk.CfnOutput(this, 'SiteBucketName', {
      value: siteBucket.bucketName,
      description: 'S3 bucket for static site assets',
    });

    new cdk.CfnOutput(this, 'CloudFrontUrl', {
      value: `https://${distribution.distributionDomainName}`,
      description: 'AutoAW Frontend CloudFront URL',
    });

    new cdk.CfnOutput(this, 'DistributionId', {
      value: distribution.distributionId,
      description: 'CloudFront Distribution ID',
    });
  }
}
