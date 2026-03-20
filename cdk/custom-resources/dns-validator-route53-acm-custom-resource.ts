import * as cdk from 'aws-cdk-lib';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export interface DnsValidatorProps {
  /** Hosted zone ID to query */
  hostedZoneId: string;
  /** Domain name to validate DNS resolution for */
  domainName: string;
  /** Expected record type, e.g. 'A', 'CNAME' */
  recordType: string;
}

/**
 * MAX Construct: Lambda-backed custom resource that validates a DNS record
 * exists in Route 53 before stack creation proceeds. Uses AwsCustomResource
 * (SDK call) for lightweight implementation without a separate Lambda function.
 */
export class DnsValidator extends Construct {
  /** The resolved DNS record value returned by Route 53 */
  public readonly recordValue: string;

  constructor(scope: Construct, id: string, props: DnsValidatorProps) {
    super(scope, id);

    const { hostedZoneId, domainName, recordType } = props;

    const dnsValidatorRole = new iam.Role(this, 'DnsValidatorRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
      inlinePolicies: {
        Route53ReadPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: [
                'route53:ListResourceRecordSets',
                'route53:GetHostedZone',
              ],
              resources: [`arn:aws:route53:::hostedzone/${hostedZoneId}`],
            }),
          ],
        }),
      },
    });

    // AwsCustomResource: calls Route53 ListResourceRecordSets on Create/Update
    const dnsLookup = new cr.AwsCustomResource(this, 'DnsLookup', {
      logRetention: logs.RetentionDays.ONE_WEEK,
      role: dnsValidatorRole,
      onCreate: {
        service: 'Route53',
        action: 'listResourceRecordSets',
        parameters: {
          HostedZoneId: hostedZoneId,
          StartRecordName: domainName,
          StartRecordType: recordType,
          MaxItems: '1',
        },
        physicalResourceId: cr.PhysicalResourceId.of(`dns-validator-${domainName}-${recordType}`),
      },
      onUpdate: {
        service: 'Route53',
        action: 'listResourceRecordSets',
        parameters: {
          HostedZoneId: hostedZoneId,
          StartRecordName: domainName,
          StartRecordType: recordType,
          MaxItems: '1',
        },
        physicalResourceId: cr.PhysicalResourceId.of(`dns-validator-${domainName}-${recordType}`),
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
        resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE,
      }),
    });

    // Extract the first record value from the response
    this.recordValue = dnsLookup.getResponseField(
      'ResourceRecordSets.0.ResourceRecords.0.Value'
    );

    new cdk.CfnOutput(scope, 'DnsValidatorRecordValue', {
      value: this.recordValue,
      description: `Resolved ${recordType} record for ${domainName}`,
    });
  }
}
