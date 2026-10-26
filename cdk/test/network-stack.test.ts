import * as cdk from 'aws-cdk-lib/core';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { NetworkStack } from '../lib/network-stack-vpc-subnets-security-groups';

describe('NetworkStack', () => {
  const stack = new NetworkStack(new cdk.App(), 'Net');
  const template = Template.fromStack(stack);

  test('has one NAT gateway and public + private subnets in two AZs', () => {
    template.resourceCountIs('AWS::EC2::NatGateway', 1);
    template.resourceCountIs('AWS::EC2::Subnet', 4);
  });

  test('flow logs capture all traffic', () => {
    template.hasResourceProperties('AWS::EC2::FlowLog', { TrafficType: 'ALL', ResourceType: 'VPC' });
  });

  test('the ALB security group accepts HTTP only (no certificate, so no 443)', () => {
    template.hasResourceProperties('AWS::EC2::SecurityGroup', {
      GroupDescription: 'Security group for Application Load Balancer',
      SecurityGroupIngress: [Match.objectLike({ CidrIp: '0.0.0.0/0', FromPort: 80, ToPort: 80 })],
    });
  });

  test('instances accept 8080 only from the ALB security group, never from a CIDR', () => {
    template.hasResourceProperties('AWS::EC2::SecurityGroupIngress', { FromPort: 8080, ToPort: 8080 });
    const sgs = template.findResources('AWS::EC2::SecurityGroup', {
      Properties: { GroupDescription: 'Security group for application EC2 instances' },
    });
    for (const sg of Object.values(sgs)) {
      expect(sg.Properties.SecurityGroupIngress ?? []).toEqual([]);
    }
  });
});
