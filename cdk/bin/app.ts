#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { NetworkStack } from '../lib/network-stack-vpc-subnets-security-groups';
import { ComputeStack } from '../lib/compute-stack-ec2-asg-alb';
import { StorageStack } from '../lib/storage-stack-s3-dynamodb';
import { PipelineStack } from '../pipeline/pipeline-stack-self-mutating-cicd';

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
};

const networkStack = new NetworkStack(app, 'NetworkStack', {
  env,
  description: 'L4: VPC, subnets, security groups',
});

const computeStack = new ComputeStack(app, 'ComputeStack', {
  env,
  description: 'L4: EC2 Auto Scaling Group + Application Load Balancer',
  vpc: networkStack.vpc,
  appSecurityGroup: networkStack.appSecurityGroup,
  albSecurityGroup: networkStack.albSecurityGroup,
});
computeStack.addDependency(networkStack);

const storageStack = new StorageStack(app, 'StorageStack', {
  env,
  description: 'L4: S3 bucket + DynamoDB table',
});

new PipelineStack(app, 'PipelineStack', {
  env,
  description: 'MAX: Self-mutating CDK Pipeline via CodePipeline',
});

app.synth();
