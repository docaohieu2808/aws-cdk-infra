# aws-cdk-infra

**Tier 4 of 5 — AWS CDK: TypeScript constructs synthesized to CloudFormation**

## Purpose

AWS-only infrastructure demonstrating the full L1→L2→L3→MAX CloudFormation/CDK abstraction ladder: raw CFN YAML → parameterized templates → nested stacks → CDK L2/L3 constructs → self-mutating CDK Pipeline sourced from GitHub.

## Position in the IaC spectrum

| Tier | Tool | Trade-off vs this tier |
|------|------|----------------------|
| 1 | Terraform + Terragrunt | Multi-cloud, HCL declarative. No synth step — state managed externally in GCS/S3. |
| 2 | OpenTofu | Same as Terraform, open-source. |
| 3 | Pulumi | Real language, multi-cloud, talks directly to cloud APIs (no CFN intermediary). |
| **4 (this)** | AWS CDK | TypeScript with deep AWS L2/L3 construct library. Synthesizes to CloudFormation — full CFN feature set, AWS-native defaults (encryption, logging). Trade-off: AWS-only; synth adds a build step; CFN stack limits apply. |
| 5 | Crossplane | Kubernetes control-plane, continuous reconciliation, cloud-agnostic CRDs. |

## Abstraction ladder (interview talking point)

```
cloudformation/
  l1-*   Raw CFN: explicit every resource, every property
  l2-*   Mappings + Conditions + Parameters — reusable across envs/regions
  l3-*   Nested stacks — compose child templates (VPC + EC2 + RDS root)
    nested/
      l3-nested-child-vpc-*     VPC child: outputs VpcId, subnet IDs
      l3-nested-child-ec2-*     EC2 child: consumes VpcId, outputs InstanceId + SecurityGroupId
      l3-nested-child-rds-*     RDS child: consumes SG from EC2 child, Secrets Manager for creds
cdk/
  lib/   L2/L3 CDK constructs (NetworkStack, ComputeStack, StorageStack)
  constructs/  Custom L3 constructs (SecureBucket, WebService, Monitoring)
  pipeline/    MAX: self-mutating CDK Pipeline (GitHub source via CodeStar Connection)
```

## Key design decisions

- **CodeCommit removed**: AWS closed CodeCommit to new customers July 2024. Pipeline uses `CodePipelineSource.connection()` (GitHub via CodeStar Connection) instead.
- **Self-mutating pipeline**: `selfMutation: true` — pushing a change to `pipeline-stack-self-mutating-cicd.ts` updates the pipeline itself before deploying app stages.
- **No hardcoded account/region**: `CDK_DEFAULT_ACCOUNT` / `CDK_DEFAULT_REGION` env vars; GitHub connection ARN via CDK context (`-c githubConnectionArn=...`) or `CDK_GITHUB_CONNECTION_ARN`.
- **RDS credentials**: Secrets Manager `GenerateSecretString` — no password in template or git.
- **CDK pinned exact**: `aws-cdk-lib 2.244.0` — exact pin (no `^`) prevents surprise construct API changes.

## Running

```bash
# Prerequisites: node >= 18, AWS CLI configured, CDK bootstrapped in target account

cd cdk
npm ci
npm run build

# Deploy individual stacks
npx cdk deploy NetworkStack ComputeStack StorageStack

# Deploy self-mutating pipeline (first time — subsequent updates are automatic)
# Step 1: create GitHub CodeStar Connection in AWS Console → CodePipeline → Connections
# Step 2: approve the pending connection
# Step 3:
npx cdk deploy PipelineStack \
  -c githubConnectionArn=arn:aws:codestar-connections:us-east-1:123456789012:connection/xxx \
  -c githubOwner=your-org \
  -c githubRepo=aws-cdk-infra

# Deploy L3 nested CFN stack directly (no CDK)
aws cloudformation deploy \
  --template-file cloudformation/l3-nested-stack-root-vpc-ec2-rds-composition.yaml \
  --stack-name l3-nested-demo \
  --parameter-overrides \
      Environment=dev \
      TemplatesBucketName=your-templates-bucket \
      KeyPairName=your-key-pair \
  --capabilities CAPABILITY_IAM
```

## Notes

- L2 CFN AMI IDs (`RegionAMIMap`) are Amazon Linux 2 era — kept for pedagogical clarity. For production resolve dynamically: `!Sub '{{resolve:ssm:/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64}}'`
- Child templates must be uploaded to S3 (`TemplatesBucketName`) before deploying the L3 root stack.
