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
 * MAX Construct: custom resource that looks a record up in Route 53 at deploy time and exposes what it found.
 * Uses AwsCustomResource (an SDK call) instead of a hand-written Lambda.
 *
 * ListResourceRecordSets returns the first record AT OR AFTER the requested name, so a missing record yields the
 * next one rather than an error. That is why the matched name and type are exposed too: compare them to what you
 * asked for before trusting `recordValue`.
 */
export class DnsValidator extends Construct {
  /** The resolved DNS record value returned by Route 53 */
  public readonly recordValue: string;
  /** Name of the record Route 53 returned (with trailing dot) */
  public readonly matchedName: string;
  /** Type of the record Route 53 returned */
  public readonly matchedType: string;

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
              resources: [
                // partition-aware, so it also works in aws-cn and aws-us-gov
                cdk.Arn.format(
                  { service: 'route53', resource: 'hostedzone', resourceName: hostedZoneId, region: '', account: '' },
                  cdk.Stack.of(this)
                ),
              ],
            }),
          ],
        }),
      },
    });

    // AwsCustomResource: calls Route53 ListResourceRecordSets on Create/Update
    const dnsLookup = new cr.AwsCustomResource(this, 'DnsLookup', {
      logGroup: new logs.LogGroup(this, 'DnsLookupLogs', { retention: logs.RetentionDays.ONE_WEEK }),
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
    this.matchedName = dnsLookup.getResponseField('ResourceRecordSets.0.Name');
    this.matchedType = dnsLookup.getResponseField('ResourceRecordSets.0.Type');

    new cdk.CfnOutput(this, 'DnsValidatorRecordValue', {
      value: this.recordValue,
      description: `Resolved ${recordType} record for ${domainName}`,
    });
  }
}
