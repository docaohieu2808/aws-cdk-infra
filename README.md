# aws-cdk-infra

AWS CDK v2 TypeScript infrastructure with L1–L3 constructs, a self-mutating CI/CD pipeline, custom CloudFormation resources, and reference CloudFormation templates.

## What's Inside

| Path | Description |
|------|-------------|
| `cdk/bin/app.ts` | CDK app entry: NetworkStack → ComputeStack → StorageStack → PipelineStack |
| `cdk/lib/network-stack-vpc-subnets-security-groups.ts` | L4: VPC, public/private subnets, security groups |
| `cdk/lib/compute-stack-ec2-asg-alb.ts` | L4: EC2 Auto Scaling Group + Application Load Balancer |
| `cdk/lib/storage-stack-s3-dynamodb.ts` | L4: S3 bucket + DynamoDB table |
| `cdk/lib/constructs/monitoring-cloudwatch-alarms-dashboard.ts` | L3 construct: CloudWatch alarms + dashboard |
| `cdk/lib/constructs/secure-bucket-encrypted-lifecycle-versioning.ts` | L3 construct: opinionated S3 bucket |
| `cdk/lib/constructs/web-service-alb-asg-health-check.ts` | L3 construct: full web service pattern |
| `cdk/custom-resources/dns-validator-route53-acm-custom-resource.ts` | Custom resource: Route53 ACM DNS validation |
| `cdk/pipeline/pipeline-stack-self-mutating-cicd.ts` | Self-mutating CDK Pipeline (CodePipeline) |
| `cloudformation/l1-basic-vpc-*.yaml` | Raw CFN: VPC reference |
| `cloudformation/l2-parameterized-ec2-*.yaml` | Raw CFN: EC2 with mappings/conditions |
| `cloudformation/l3-nested-stack-*.yaml` | Raw CFN: nested stacks composition |

## Levels

| Level | Skill | What You Do |
|-------|-------|-------------|
| L1 | CloudFormation | Read/write raw YAML templates; understand resources, parameters, outputs |
| L2 | CDK basics | `cdk synth/diff/deploy`; understand L1 (Cfn*) vs L2 constructs |
| L3 | Custom constructs | Build reusable L3 constructs; compose from L2 primitives |
| L4 | Multi-stack apps | Wire stack dependencies; pass VPC/SG across stacks |
| L5 | Custom resources | Write Lambda-backed custom resources for resources CDK doesn't support |
| L6 | CDK Pipelines | Self-mutating pipeline; stages with pre/post steps; approval gates |
| MAX | Full ownership | Cross-account/cross-region deployments; CDK Aspects for policy enforcement |

## Prerequisites

- Node.js >= 18
- AWS CDK v2: `npm install -g aws-cdk`
- AWS CLI configured: `aws configure` or `AWS_PROFILE` set
- Bootstrap CDK in your account (one-time):

```bash
cdk bootstrap aws://ACCOUNT_ID/us-east-1
```

```bash
cd cdk
npm install
```

## Quick Start

```bash
cd cdk

# Synthesize CloudFormation templates (no AWS calls)
cdk synth

# Review what will change
cdk diff

# Deploy all stacks
cdk deploy --all

# Deploy a single stack
cdk deploy NetworkStack
```

## Usage Examples

### Deploy stacks in dependency order

```bash
cdk deploy NetworkStack ComputeStack StorageStack
```

### Use a custom L3 construct

```typescript
import { SecureBucket } from './constructs/secure-bucket-encrypted-lifecycle-versioning';

const bucket = new SecureBucket(this, 'AppData', {
  bucketName: 'my-app-data',
  lifecycleDays: 90,
});
```

### Use the web service construct

```typescript
import { WebService } from './constructs/web-service-alb-asg-health-check';

const service = new WebService(this, 'Api', {
  vpc: network.vpc,
  minCapacity: 1,
  maxCapacity: 4,
  instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.SMALL),
});
```

### Deploy the self-mutating pipeline

```bash
cdk deploy PipelineStack
# Pipeline auto-updates itself on git push to main
```

### Validate raw CloudFormation templates

```bash
aws cloudformation validate-template \
  --template-body file://cloudformation/l1-basic-vpc-with-public-private-subnets-nat-gateway.yaml
```

## Stack Dependency Order

```
NetworkStack
    └── ComputeStack (needs vpc, securityGroups)
    └── StorageStack
PipelineStack (independent, manages all above via CDK Pipeline stages)
```

## Environment Config

```bash
export CDK_DEFAULT_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
export CDK_DEFAULT_REGION=us-east-1
```
