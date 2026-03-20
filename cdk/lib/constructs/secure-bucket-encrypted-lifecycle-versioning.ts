import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export interface SecureBucketProps {
  /**
   * Optional lifecycle rules. Defaults to 30d→IA, 90d→Glacier, expire 365d.
   */
  lifecycleRules?: s3.LifecycleRule[];
  /**
   * Removal policy. Defaults to RETAIN.
   */
  removalPolicy?: cdk.RemovalPolicy;
}

/**
 * L5 Construct: S3 bucket with encryption, versioning, access logging,
 * public access block, and configurable lifecycle rules.
 */
export class SecureBucket extends Construct {
  public readonly bucket: s3.Bucket;
  public readonly accessLogsBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: SecureBucketProps = {}) {
    super(scope, id);

    this.accessLogsBucket = new s3.Bucket(this, 'AccessLogs', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: props.removalPolicy ?? cdk.RemovalPolicy.RETAIN,
      autoDeleteObjects: false,
      lifecycleRules: [
        {
          id: 'expire-logs',
          enabled: true,
          expiration: cdk.Duration.days(90),
        },
      ],
    });

    const defaultLifecycleRules: s3.LifecycleRule[] = [
      {
        id: 'transition-to-ia',
        enabled: true,
        transitions: [
          {
            storageClass: s3.StorageClass.INFREQUENT_ACCESS,
            transitionAfter: cdk.Duration.days(30),
          },
          {
            storageClass: s3.StorageClass.GLACIER,
            transitionAfter: cdk.Duration.days(90),
          },
        ],
        expiration: cdk.Duration.days(365),
      },
    ];

    this.bucket = new s3.Bucket(this, 'Bucket', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      serverAccessLogsBucket: this.accessLogsBucket,
      serverAccessLogsPrefix: `${id}/`,
      lifecycleRules: props.lifecycleRules ?? defaultLifecycleRules,
      removalPolicy: props.removalPolicy ?? cdk.RemovalPolicy.RETAIN,
      autoDeleteObjects: false,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
    });
  }
}
