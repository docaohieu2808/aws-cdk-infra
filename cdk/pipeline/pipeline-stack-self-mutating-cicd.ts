import * as cdk from 'aws-cdk-lib';
import * as pipelines from 'aws-cdk-lib/pipelines';
import { Construct } from 'constructs';
import { NetworkStack } from '../lib/network-stack-vpc-subnets-security-groups';
import { ComputeStack } from '../lib/compute-stack-ec2-asg-alb';
import { StorageStack } from '../lib/storage-stack-s3-dynamodb';

/**
 * Application stage: groups all app stacks for a given environment.
 * CDK Pipelines deploys this stage as a unit.
 */
class AppStage extends cdk.Stage {
  constructor(scope: Construct, id: string, props?: cdk.StageProps) {
    super(scope, id, props);

    const networkStack = new NetworkStack(this, 'NetworkStack');

    const computeStack = new ComputeStack(this, 'ComputeStack', {
      vpc: networkStack.vpc,
      appSecurityGroup: networkStack.appSecurityGroup,
      albSecurityGroup: networkStack.albSecurityGroup,
    });
    computeStack.addDependency(networkStack);

    new StorageStack(this, 'StorageStack');
  }
}

/**
 * MAX Stack: Self-mutating CDK Pipeline using pipelines.CodePipeline.
 *
 * Source: GitHub via CodeStar Connection (replaces CodeCommit — AWS closed
 * CodeCommit to new customers July 2024; existing repos still work but new
 * infrastructure should use CodePipelineSource.connection() with GitHub).
 *
 * Prerequisites:
 *   1. Create a CodeStar Connection to GitHub in the AWS Console
 *      (CodePipeline → Settings → Connections → Create connection → GitHub).
 *   2. Approve the connection (pending → available) via the Console.
 *   3. Pass the connection ARN via CDK context or environment variable:
 *        cdk deploy -c githubConnectionArn=arn:aws:codestar-connections:...
 */
export class PipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Resolve GitHub CodeStar Connection ARN from context (preferred) or env var.
    // Set via: cdk deploy -c githubConnectionArn=arn:aws:codestar-connections:...
    // or: export CDK_GITHUB_CONNECTION_ARN=arn:aws:codestar-connections:...
    const connectionArn =
      this.node.tryGetContext('githubConnectionArn') ??
      process.env.CDK_GITHUB_CONNECTION_ARN;

    if (!connectionArn) {
      throw new Error(
        'GitHub CodeStar Connection ARN is required. ' +
        'Pass via: cdk deploy -c githubConnectionArn=<arn> ' +
        'or set CDK_GITHUB_CONNECTION_ARN env var. ' +
        'Create the connection in: AWS Console → CodePipeline → Settings → Connections.'
      );
    }

    // GitHub source via CodeStar Connection — replaces CodeCommit.
    // Repo format: 'owner/repo-name'
    const githubOwner =
      this.node.tryGetContext('githubOwner') ??
      process.env.CDK_GITHUB_OWNER ??
      'your-org';
    const githubRepo =
      this.node.tryGetContext('githubRepo') ??
      process.env.CDK_GITHUB_REPO ??
      'aws-cdk-infra';

    const source = pipelines.CodePipelineSource.connection(
      `${githubOwner}/${githubRepo}`,
      'main',
      { connectionArn }
    );

    const pipeline = new pipelines.CodePipeline(this, 'Pipeline', {
      pipelineName: 'aws-cdk-infra-pipeline',
      selfMutation: true,
      crossAccountKeys: false,
      synth: new pipelines.ShellStep('Synth', {
        input: source,
        commands: [
          'cd cdk',
          'npm ci',
          'npm run build',
          'npx cdk synth',
        ],
        primaryOutputDirectory: 'cdk/cdk.out',
      }),
      dockerEnabledForSynth: false,
    });

    // Dev stage — auto-deploy on every commit to main
    const devStage = pipeline.addStage(
      new AppStage(this, 'Dev', {
        env: {
          account: this.account,
          region: this.region,
        },
      })
    );

    devStage.addPost(
      new pipelines.ShellStep('IntegTest', {
        commands: ['echo "Run integration tests against Dev"'],
      })
    );

    // Prod stage — requires manual approval after Dev succeeds
    const prodStage = pipeline.addStage(
      new AppStage(this, 'Prod', {
        env: {
          account: this.account,
          region: this.region,
        },
      }),
      {
        pre: [
          new pipelines.ManualApprovalStep('PromoteToProd', {
            comment: 'Approve deployment to production',
          }),
        ],
      }
    );

    prodStage.addPost(
      new pipelines.ShellStep('SmokeTest', {
        commands: ['echo "Run smoke tests against Prod"'],
      })
    );

    new cdk.CfnOutput(this, 'PipelineSourceInfo', {
      value: `${githubOwner}/${githubRepo} (main) via CodeStar Connection`,
      description: 'GitHub source for this CDK Pipeline',
    });
  }
}
