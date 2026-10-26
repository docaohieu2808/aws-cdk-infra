import * as cdk from 'aws-cdk-lib/core';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { StorageStack } from '../lib/storage-stack-s3-dynamodb';

describe('StorageStack security properties', () => {
  const template = Template.fromStack(new StorageStack(new cdk.App(), 'Storage'));

  test('every bucket is encrypted and blocks all public access', () => {
    const buckets = template.findResources('AWS::S3::Bucket');
    expect(Object.keys(buckets)).toHaveLength(2); // data bucket + its access-log bucket
    for (const bucket of Object.values(buckets)) {
      expect(bucket.Properties.BucketEncryption.ServerSideEncryptionConfiguration[0]).toMatchObject({
        ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' },
      });
      expect(bucket.Properties.PublicAccessBlockConfiguration).toEqual({
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      });
    }
  });

  test('the data bucket is versioned, logs access and is retained on stack deletion', () => {
    template.hasResource('AWS::S3::Bucket', {
      Properties: {
        VersioningConfiguration: { Status: 'Enabled' },
        LoggingConfiguration: Match.objectLike({ LogFilePrefix: 'AppBucket/' }),
      },
      DeletionPolicy: 'Retain',
    });
  });

  test('buckets refuse non-TLS requests', () => {
    template.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({ Effect: 'Deny', Condition: { Bool: { 'aws:SecureTransport': 'false' } } }),
        ]),
      },
    });
  });

  test('the table is on-demand, encrypted, point-in-time recoverable and retained', () => {
    template.hasResource('AWS::DynamoDB::Table', {
      Properties: {
        BillingMode: 'PAY_PER_REQUEST',
        PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
        SSESpecification: { SSEEnabled: true },
      },
      DeletionPolicy: 'Retain',
    });
  });

  test('alarms watch the table', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', { MetricName: 'ThrottledRequests' });
  });
});
