# aws-cdk-infra

**Tier 4 of 5 - AWS CDK: TypeScript constructs synthesized to CloudFormation**

[![ci](https://github.com/docaohieu2808/aws-cdk-infra/actions/workflows/ci.yml/badge.svg)](https://github.com/docaohieu2808/aws-cdk-infra/actions/workflows/ci.yml)

## What it teaches

AWS-only infrastructure walking the whole abstraction ladder: raw CloudFormation YAML, parameterized templates,
nested stacks, CDK L2/L3 constructs, and a self-mutating CDK Pipeline sourced from GitHub. Everything is checked
without an AWS account: assertion tests, offline `cdk synth`, cfn-lint and checkov.

## Position in the IaC spectrum

| Tier | Tool | Trade-off vs this tier |
|------|------|----------------------|
| 1 | Terraform + Terragrunt | Multi-cloud, HCL declarative. No synth step - state managed externally in GCS/S3. |
| 2 | OpenTofu | Same as Terraform, open-source. |
| 3 | Pulumi | Real language, multi-cloud, talks directly to cloud APIs (no CFN intermediary). |
| **4 (this)** | AWS CDK | TypeScript with a deep AWS construct library. Synthesizes to CloudFormation: full CFN feature set, AWS-native defaults. Trade-off: AWS-only; a synth step; CFN stack limits apply. |
| 5 | Crossplane | Kubernetes control plane, continuous reconciliation, cloud-agnostic CRDs. |

## Level map

```
cloudformation/
  l1-*   Raw CFN: every resource, every property (VPC, subnets, NAT)
  l2-*   Parameters + Mappings + Conditions: one template for dev/staging/prod; AMI resolved from SSM
  l3-*   Nested stacks: a root composes VPC + EC2 + RDS child templates
    nested/
      l3-nested-child-vpc-*     VPC child: outputs VpcId, subnet IDs
      l3-nested-child-ec2-*     EC2 child: consumes VpcId, outputs InstanceId + SecurityGroupId
      l3-nested-child-rds-*     RDS child: MySQL 8.4, credentials generated in Secrets Manager
cdk/
  bin/app.ts             entry point: Network, Compute, Storage and Pipeline stacks
  lib/                   NetworkStack, ComputeStack, StorageStack (L2 constructs)
  lib/constructs/        custom L3 constructs: SecureBucket, WebService, Monitoring
  custom-resources/      DnsValidator: Route 53 lookup through AwsCustomResource (opt-in, not wired into the app)
  pipeline/              MAX: self-mutating CDK Pipeline (GitHub via CodeStar connection), Dev then Prod stage
  test/                  assertion tests (aws-cdk-lib/assertions)
```

## Key design decisions

- **CodeCommit is not used.** AWS closed it to new customers in July 2024; the pipeline uses
  `CodePipelineSource.connection()` (GitHub through a CodeStar connection).
- **The pipeline synthesizes without a real connection.** With no `githubConnectionArn` it uses a clearly named
  `PLACEHOLDER_CONNECTION_ARN` and attaches a warning; it can then be synthesized, linted and tested but not deployed.
  The same settings are passed into the CodeBuild synth step as environment variables, so the pipeline rebuilds itself
  identically. Pipeline type is V2; the source branch defaults to `master` (override with `-c githubBranch=...`).
- **Instances serve their own health check.** The launch template starts a tiny HTTP server on 8080 that answers
  `/health`; without it the ELB health check would fail and the ASG would replace every instance forever.
- **No hard-coded AMIs.** CDK uses `MachineImage.latestAmazonLinux2023()` (an SSM parameter); the CloudFormation
  templates take an `AWS::SSM::Parameter::Value<AWS::EC2::Image::Id>` parameter.
- **Security defaults are asserted, not assumed:** every bucket encrypted + public access blocked + TLS only, DynamoDB
  point-in-time recovery and encryption, IMDSv2 required, EBS always encrypted, the SNS alarm topic encrypted with a
  customer-managed key, ALB drops invalid headers.
- **Feature flags** in `cdk/cdk.json` are exactly what `cdk init` writes for the pinned CDK (88 flags) plus the one
  flag the library knows that the CLI template does not yet list. CI fails if a new recommended flag appears.
- **`aws-cdk-lib` is pinned exactly** (`2.274.0`) so construct behaviour does not change under you; Dependabot proposes
  bumps weekly. TypeScript 7 and `tsx` are used the way `cdk init` now generates projects.
- **RDS credentials** come from Secrets Manager `GenerateSecretString`, never from the template or git.

## Running it

```bash
# Prerequisites: Node 24 LTS (aws-cdk-lib needs >= 20), AWS CLI configured and CDK bootstrapped for a real deploy

cd cdk
npm ci
npm test                      # assertion tests, no AWS needed
npx cdk synth                 # all four stacks, offline

# Deploy the application stacks
npx cdk deploy NetworkStack ComputeStack StorageStack

# Deploy the self-mutating pipeline (first time; later updates are automatic)
# 1. AWS Console > CodePipeline > Settings > Connections > create a GitHub connection, approve it
# 2.
npx cdk deploy PipelineStack \
  -c githubConnectionArn=arn:aws:codestar-connections:us-east-1:123456789012:connection/xxx \
  -c githubOwner=your-org -c githubRepo=aws-cdk-infra -c githubBranch=master

# Deploy the L3 nested CloudFormation stack directly (no CDK)
aws s3 cp cloudformation/nested/ s3://your-templates-bucket/nested/ --recursive
aws cloudformation deploy \
  --template-file cloudformation/l3-nested-stack-root-vpc-ec2-rds-composition.yaml \
  --stack-name l3-nested-demo \
  --parameter-overrides Environment=dev TemplatesBucketName=your-templates-bucket KeyPairName=your-key-pair \
  --capabilities CAPABILITY_IAM
```

Child templates must be uploaded to the S3 bucket named by `TemplatesBucketName` before the root stack is deployed.

## What CI checks (`.github/workflows/ci.yml`)

Runs on push, pull request, manual dispatch and every Monday 02:41 UTC.

- **lint**: actionlint; every action pinned to an existing commit SHA.
- **cloudformation**: cfn-lint (warnings fail the job) and checkov on the hand-written templates.
- **cdk**: `npm ci`, `tsc`, jest assertion tests, `cdk synth` for all stacks offline (including both pipeline stages),
  the feature-flag check, then cfn-lint and checkov on every synthesized template.
- checkov skips are listed in `.checkov.yaml`, each with its reason (demo trade-offs and CDK-owned helper resources).
  cfn-lint ignores only W3005 on the synthesized templates (a redundant `DependsOn` that CDK itself generates).

## Honest limits

- Nothing is deployed in CI: that needs an AWS account. `cdk synth`, the tests and the linters are the proof; the
  first real deploy is yours.
- The pipeline's Dev and Prod stages deploy into the same account and region as the pipeline, so "Prod" is an approval
  gate, not isolation. For real isolation use one account per stage. `bin/app.ts` also deploys the same stacks
  directly; use either path, not both, in one account.
- The load balancer listens on HTTP:80 only: there is no domain or certificate in this repo, so there is no HTTPS.
- `DnsValidator` is an example construct, not part of the default app. Route 53 `ListResourceRecordSets` returns the
  next record when the one asked for does not exist, so the construct exposes the matched name and type for you to
  compare instead of claiming to validate.
- The RDS child template pins MySQL `8.4.11`; RDS retires minor versions, so expect to bump it.
