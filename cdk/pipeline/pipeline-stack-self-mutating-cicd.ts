import * as cdk from 'aws-cdk-lib';
import * as codecommit from 'aws-cdk-lib/aws-codecommit';
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
 * Pulls source from CodeCommit, runs synth, then deploys to dev and prod stages.
 * The pipeline updates itself when pipeline-stack changes are pushed.
 */
export class PipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // CodeCommit repo as source (swap for GitHub connection if preferred)
    const repo = new codecommit.Repository(this, 'InfraRepo', {
      repositoryName: 'aws-cdk-infra',
      description: 'CDK infrastructure repository',
    });

    const pipeline = new pipelines.CodePipeline(this, 'Pipeline', {
      pipelineName: 'aws-cdk-infra-pipeline',
      selfMutation: true,
      crossAccountKeys: false,
      synth: new pipelines.ShellStep('Synth', {
        input: pipelines.CodePipelineSource.codeCommit(repo, 'main'),
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

    // Dev stage — auto-deploy on every commit
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

    new cdk.CfnOutput(this, 'RepoCloneUrl', {
      value: repo.repositoryCloneUrlHttp,
      description: 'CodeCommit HTTPS clone URL',
    });
  }
}
