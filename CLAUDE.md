# AutoAW — Claude instructions

## Deployment

**`dprod`** = deploy to production.

Deploy means: commit all changes, push to `main`. GitHub Actions (`deploy.yml`) handles the rest — CDK stacks, frontend build with correct `NEXT_PUBLIC_API_URL`, S3 sync, and CloudFront invalidation.

```bash
git add <files>
git commit -m "..."
git push origin main   # triggers .github/workflows/deploy.yml
```

Never manually sync to S3 or invalidate CloudFront — the workflow does it automatically and also sets the correct API URL from CDK outputs.

## Infrastructure

- **Custom domain**: `https://autoaw.app`
- **CloudFront**: `E2ZW7P7LJXOL9K` → `https://d2dnaqhqu223h4.cloudfront.net`
- **S3 bucket**: `autoawfrontend-sitebucket397a1860-mpnalr2xsp3f`
- **API Gateway**: `https://5oahxb0xj7.execute-api.eu-central-1.amazonaws.com`
- **AWS region**: `eu-central-1`
- **CDK stacks**: `AutoAwFrontend`, `AutoAwApi`, `AutoAwEngine`, `AutoAwStorage`, `AutoAw-GitHubActions`, `AutoAwCertificate`
