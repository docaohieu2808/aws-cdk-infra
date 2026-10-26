import * as cdk from 'aws-cdk-lib/core';
import { Annotations, Match, Template } from 'aws-cdk-lib/assertions';
import { PLACEHOLDER_CONNECTION_ARN, PipelineStack } from '../pipeline/pipeline-stack-self-mutating-cicd';

const REAL_ARN = 'arn:aws:codestar-connections:us-east-1:111122223333:connection/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

describe('PipelineStack without a connection ARN', () => {
  const saved = process.env.CDK_GITHUB_CONNECTION_ARN;
  beforeAll(() => delete process.env.CDK_GITHUB_CONNECTION_ARN);
  afterAll(() => {
    if (saved !== undefined) process.env.CDK_GITHUB_CONNECTION_ARN = saved;
  });

  const stack = new PipelineStack(new cdk.App(), 'Pipeline');

  test('still synthesizes, using the clearly marked placeholder and a warning', () => {
    const template = Template.fromStack(stack);
    expect(JSON.stringify(template.toJSON())).toContain(PLACEHOLDER_CONNECTION_ARN);
    Annotations.fromStack(stack).hasWarning('*', Match.stringLikeRegexp('PLACEHOLDER'));
  });

  test('is a V2 pipeline with self-mutation and a manual approval before prod', () => {
    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::CodePipeline::Pipeline', { PipelineType: 'V2' });
    const json = JSON.stringify(template.findResources('AWS::CodePipeline::Pipeline'));
    expect(json).toContain('UpdatePipeline');
    expect(json).toContain('PromoteToProd');
  });
});

describe('PipelineStack with a connection ARN', () => {
  const app = new cdk.App({ context: { githubConnectionArn: REAL_ARN, githubOwner: 'someone', githubBranch: 'trunk' } });
  const stack = new PipelineStack(app, 'Pipeline');
  const template = Template.fromStack(stack);

  test('uses the supplied ARN, owner and branch and warns about nothing', () => {
    const json = JSON.stringify(template.toJSON());
    expect(json).toContain(REAL_ARN);
    expect(json).not.toContain(PLACEHOLDER_CONNECTION_ARN);
    expect(json).toContain('someone/aws-cdk-infra');
    expect(json).toContain('"BranchName":"trunk"');
    Annotations.fromStack(stack).hasNoWarning('*', Match.stringLikeRegexp('PLACEHOLDER'));
  });

  test('passes the settings to the CodeBuild synth step, so it rebuilds the same pipeline', () => {
    const projects = JSON.stringify(template.findResources('AWS::CodeBuild::Project'));
    expect(projects).toContain('CDK_GITHUB_CONNECTION_ARN');
    expect(projects).toContain(REAL_ARN);
  });
});
