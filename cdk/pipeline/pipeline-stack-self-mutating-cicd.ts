import * as cdk from 'aws-cdk-lib';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as pipelines from 'aws-cdk-lib/pipelines';
import { Construct } from 'constructs';
import { NetworkStack } from '../lib/network-stack-vpc-subnets-security-groups';
import { ComputeStack } from '../lib/compute-stack-ec2-asg-alb';
import { StorageStack } from '../lib/storage-stack-s3-dynamodb';

/** Obviously fake ARN used only so the pipeline can be synthesized without a real connection. */
export const PLACEHOLDER_CONNECTION_ARN =
  'arn:aws:codestar-connections:us-east-1:000000000000:connection/00000000-0000-0000-0000-000000000000';

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
 *      (without it the stack synthesizes with a placeholder and cannot be deployed).
 */
export class PipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Resolve the GitHub CodeStar Connection ARN from context (preferred) or env var:
    //   cdk deploy -c githubConnectionArn=arn:aws:codestar-connections:...
    //   export CDK_GITHUB_CONNECTION_ARN=arn:aws:codestar-connections:...
    // When neither is set the stack still synthesizes (CI, `cdk synth`, tests) using PLACEHOLDER_CONNECTION_ARN and
    // a warning is attached; deploying that template fails in CloudFormation because the connection does not exist.
    const suppliedArn: string | undefined =
      this.node.tryGetContext('githubConnectionArn') ?? process.env.CDK_GITHUB_CONNECTION_ARN;
    const connectionArn = suppliedArn ?? PLACEHOLDER_CONNECTION_ARN;
    if (!suppliedArn) {
      cdk.Annotations.of(this).addWarning(
        'No GitHub CodeStar connection ARN supplied (-c githubConnectionArn=... or CDK_GITHUB_CONNECTION_ARN): ' +
          'using a PLACEHOLDER. Synth works, deploy will fail until a real, approved connection is given. ' +
          'Create it in: AWS Console > CodePipeline > Settings > Connections.'
      );
    }

    const githubOwner =
      this.node.tryGetContext('githubOwner') ?? process.env.CDK_GITHUB_OWNER ?? 'docaohieu2808';
    const githubRepo =
      this.node.tryGetContext('githubRepo') ?? process.env.CDK_GITHUB_REPO ?? 'aws-cdk-infra';
    const githubBranch =
      this.node.tryGetContext('githubBranch') ?? process.env.CDK_GITHUB_BRANCH ?? 'master';

    const source = pipelines.CodePipelineSource.connection(`${githubOwner}/${githubRepo}`, githubBranch, {
      connectionArn,
    });

    const pipeline = new pipelines.CodePipeline(this, 'Pipeline', {
      pipelineName: 'aws-cdk-infra-pipeline',
      pipelineType: codepipeline.PipelineType.V2,
      selfMutation: true,
      crossAccountKeys: false,
      synth: new pipelines.ShellStep('Synth', {
        input: source,
        // The synth step runs `cdk synth` inside CodeBuild, where this stack is built again: pass the same
        // settings through the environment so it produces the same pipeline.
        env: {
          CDK_GITHUB_CONNECTION_ARN: connectionArn,
          CDK_GITHUB_OWNER: githubOwner,
          CDK_GITHUB_REPO: githubRepo,
          CDK_GITHUB_BRANCH: githubBranch,
        },
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
      value: `${githubOwner}/${githubRepo} (${githubBranch}) via CodeStar Connection`,
      description: 'GitHub source for this CDK Pipeline',
    });
  }
}
