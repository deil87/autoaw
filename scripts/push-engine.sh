#!/usr/bin/env bash
# Build the engine worker image and push it to ECR.
# Usage: ./scripts/push-engine.sh [tag]   (tag defaults to "latest")
# Run from the repo root.
set -euo pipefail

REGION=eu-central-1
ACCOUNT=852857723337
REPO=autoaw-engine
TAG=${1:-latest}
IMAGE="$ACCOUNT.dkr.ecr.$REGION.amazonaws.com/$REPO:$TAG"

echo "→ Logging in to ECR..."
aws ecr get-login-password --region "$REGION" --profile amplify-policy-852857723337 \
  | docker login --username AWS --password-stdin "$ACCOUNT.dkr.ecr.$REGION.amazonaws.com"

echo "→ Building $IMAGE ..."
docker build \
  --platform linux/amd64 \
  -f backend/engine/worker/Dockerfile \
  -t "$IMAGE" \
  .

echo "→ Pushing $IMAGE ..."
docker push "$IMAGE"

echo "✓ Done: $IMAGE"
