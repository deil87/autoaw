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
- **AWS region**: `eu-central-1`
- **CDK stacks**: `AutoAwFrontend`, `AutoAwApi`, `AutoAwEngine`, `AutoAwStorage`, `AutoAw-GitHubActions`, `AutoAwCertificate`
