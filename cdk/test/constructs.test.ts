import * as cdk from 'aws-cdk-lib/core';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { DnsValidator } from '../custom-resources/dns-validator-route53-acm-custom-resource';
import { Monitoring } from '../lib/constructs/monitoring-cloudwatch-alarms-dashboard';

describe('DnsValidator', () => {
  const stack = new cdk.Stack(new cdk.App(), 'Dns');
  new DnsValidator(stack, 'First', { hostedZoneId: 'Z123', domainName: 'a.example.com', recordType: 'A' });
  // Two validators in one stack used to clash on the output id.
  new DnsValidator(stack, 'Second', { hostedZoneId: 'Z123', domainName: 'b.example.com', recordType: 'CNAME' });
  const template = Template.fromStack(stack);

  test('two instances can live in one stack', () => {
    template.resourceCountIs('Custom::AWS', 2);
  });

  test('uses an explicit log group, not the legacy logRetention', () => {
    template.resourceCountIs('Custom::LogRetention', 0);
    template.hasResourceProperties('AWS::Logs::LogGroup', { RetentionInDays: 7 });
  });

  test('scopes the IAM policy to the hosted zone with a partition-aware ARN', () => {
    const policy = JSON.stringify(template.findResources('AWS::IAM::Role'));
    expect(policy).toContain('AWS::Partition');
    expect(policy).toContain(':route53:::hostedzone/Z123');
    expect(policy).not.toContain('"arn:aws:route53');
  });
});

describe('Monitoring', () => {
  const stack = new cdk.Stack(new cdk.App(), 'Mon');
  new Monitoring(stack, 'Mon', {
    serviceName: 'svc',
    alarmEmail: 'ops@example.com',
    albFullName: 'app/x/123',
    asgName: 'asg',
    dynamoTableName: 'tbl',
  });
  const template = Template.fromStack(stack);

  test('creates a topic with an email subscription, a dashboard and four alarms that notify the topic', () => {
    template.hasResourceProperties('AWS::SNS::Topic', { KmsMasterKeyId: Match.anyValue() });
    template.hasResourceProperties('AWS::KMS::Key', { EnableKeyRotation: true });
    template.hasResourceProperties('AWS::SNS::Subscription', { Protocol: 'email', Endpoint: 'ops@example.com' });
    template.resourceCountIs('AWS::CloudWatch::Dashboard', 1);
    template.resourceCountIs('AWS::CloudWatch::Alarm', 4);
    for (const alarm of Object.values(template.findResources('AWS::CloudWatch::Alarm'))) {
      expect(alarm.Properties.AlarmActions).toHaveLength(1);
    }
    template.hasResourceProperties('AWS::CloudWatch::Alarm', Match.objectLike({ MetricName: 'ThrottledRequests' }));
  });
});
