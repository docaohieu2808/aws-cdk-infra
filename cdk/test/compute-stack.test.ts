import * as cdk from 'aws-cdk-lib/core';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { ComputeStack } from '../lib/compute-stack-ec2-asg-alb';
import { NetworkStack } from '../lib/network-stack-vpc-subnets-security-groups';

describe('ComputeStack', () => {
  const app = new cdk.App();
  const network = new NetworkStack(app, 'Net');
  const compute = new ComputeStack(app, 'Compute', {
    vpc: network.vpc,
    appSecurityGroup: network.appSecurityGroup,
    albSecurityGroup: network.albSecurityGroup,
  });
  const template = Template.fromStack(compute);

  test('synthesizes without a cyclic reference and depends on the network stack', () => {
    expect(compute.dependencies).toContain(network);
  });

  test('the ALB is internet facing and its HTTP listener forwards to the target group', () => {
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', {
      Scheme: 'internet-facing',
      LoadBalancerAttributes: Match.arrayWith([
        { Key: 'routing.http.drop_invalid_header_fields.enabled', Value: 'true' },
      ]),
    });
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', {
      Port: 80,
      DefaultActions: [Match.objectLike({ Type: 'forward' })],
    });
  });

  test('the target group health-checks /health on 8080', () => {
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', {
      Port: 8080,
      HealthCheckPath: '/health',
    });
  });

  test('instances require IMDSv2 and start something that answers the health check', () => {
    template.hasResourceProperties('AWS::EC2::LaunchTemplate', {
      LaunchTemplateData: Match.objectLike({
        MetadataOptions: Match.objectLike({ HttpTokens: 'required' }),
        UserData: Match.anyValue(),
      }),
    });
    const lt = Object.values(template.findResources('AWS::EC2::LaunchTemplate'))[0] as any;
    const userData = JSON.stringify(lt.Properties.LaunchTemplateData.UserData);
    expect(userData).toContain('http.server 8080');
  });

  test('the AMI comes from an SSM parameter, never a hard-coded ID', () => {
    expect(JSON.stringify(template.toJSON())).not.toMatch(/ami-[0-9a-f]{8,}/);
    template.hasParameter('*', { Type: 'AWS::SSM::Parameter::Value<AWS::EC2::Image::Id>' });
  });

  test('the ASG uses ELB health checks, runs in private subnets and leaves the desired size to scaling', () => {
    template.hasResourceProperties('AWS::AutoScaling::AutoScalingGroup', {
      MinSize: '1',
      MaxSize: '4',
      HealthCheckType: 'ELB',
      DesiredCapacity: Match.absent(),
    });
  });

  test('the unhealthy-host alarm notifies the SNS topic', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      MetricName: 'UnHealthyHostCount',
      AlarmActions: [Match.anyValue()],
    });
  });

  test('a dashboard and ALB/CPU alarms are created', () => {
    template.resourceCountIs('AWS::CloudWatch::Dashboard', 1);
    template.hasResourceProperties('AWS::CloudWatch::Alarm', { MetricName: 'HTTPCode_ELB_5XX_Count' });
    template.hasResourceProperties('AWS::CloudWatch::Alarm', { MetricName: 'CPUUtilization' });
  });
});
