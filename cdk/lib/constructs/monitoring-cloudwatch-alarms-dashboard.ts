import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import { Construct } from 'constructs';

export interface MonitoringProps {
  /** Stack/service name used as dashboard and alarm prefix */
  serviceName: string;
  /** Optional email to receive alarm notifications */
  alarmEmail?: string;
  /** ALB full name for ALB metrics (optional) */
  albFullName?: string;
  /** ASG name for EC2 metrics (optional) */
  asgName?: string;
  /** DynamoDB table name for DB metrics (optional) */
  dynamoTableName?: string;
}

/**
 * L5 Construct: CloudWatch alarms, SNS topic for notifications,
 * and a consolidated dashboard for the service.
 */
export class Monitoring extends Construct {
  public readonly alarmTopic: sns.Topic;
  public readonly dashboard: cloudwatch.Dashboard;

  constructor(scope: Construct, id: string, props: MonitoringProps) {
    super(scope, id);

    const { serviceName, alarmEmail, albFullName, asgName, dynamoTableName } = props;

    // SNS topic for alarm actions
    this.alarmTopic = new sns.Topic(this, 'AlarmTopic', {
      displayName: `${serviceName}-alarms`,
    });

    if (alarmEmail) {
      this.alarmTopic.addSubscription(new subscriptions.EmailSubscription(alarmEmail));
    }

    const snsAction = new actions.SnsAction(this.alarmTopic);
    const widgets: cloudwatch.IWidget[] = [];

    // ALB widgets and alarms
    if (albFullName) {
      const p5xxMetric = new cloudwatch.Metric({
        namespace: 'AWS/ApplicationELB',
        metricName: 'HTTPCode_ELB_5XX_Count',
        dimensionsMap: { LoadBalancer: albFullName },
        statistic: 'Sum',
        period: cdk.Duration.minutes(1),
      });

      const targetResponseTime = new cloudwatch.Metric({
        namespace: 'AWS/ApplicationELB',
        metricName: 'TargetResponseTime',
        dimensionsMap: { LoadBalancer: albFullName },
        statistic: 'p99',
        period: cdk.Duration.minutes(1),
      });

      const p5xxAlarm = new cloudwatch.Alarm(this, 'Alb5xxAlarm', {
        alarmName: `${serviceName}-alb-5xx-high`,
        metric: p5xxMetric,
        threshold: 10,
        evaluationPeriods: 3,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      p5xxAlarm.addAlarmAction(snsAction);

      const latencyAlarm = new cloudwatch.Alarm(this, 'AlbLatencyAlarm', {
        alarmName: `${serviceName}-alb-p99-latency-high`,
        metric: targetResponseTime,
        threshold: 1,
        evaluationPeriods: 3,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      latencyAlarm.addAlarmAction(snsAction);

      widgets.push(
        new cloudwatch.GraphWidget({
          title: 'ALB 5xx Errors',
          left: [p5xxMetric],
          width: 12,
        }),
        new cloudwatch.GraphWidget({
          title: 'ALB p99 Latency',
          left: [targetResponseTime],
          width: 12,
        })
      );
    }

    // ASG / EC2 widgets and alarms
    if (asgName) {
      const cpuMetric = new cloudwatch.Metric({
        namespace: 'AWS/EC2',
        metricName: 'CPUUtilization',
        dimensionsMap: { AutoScalingGroupName: asgName },
        statistic: 'Average',
        period: cdk.Duration.minutes(5),
      });

      const cpuAlarm = new cloudwatch.Alarm(this, 'CpuAlarm', {
        alarmName: `${serviceName}-cpu-high`,
        metric: cpuMetric,
        threshold: 80,
        evaluationPeriods: 3,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      cpuAlarm.addAlarmAction(snsAction);

      widgets.push(
        new cloudwatch.GraphWidget({
          title: 'EC2 CPU Utilization',
          left: [cpuMetric],
          width: 12,
        })
      );
    }

    // DynamoDB widgets and alarms
    if (dynamoTableName) {
      const throttleMetric = new cloudwatch.Metric({
        namespace: 'AWS/DynamoDB',
        metricName: 'ThrottledRequests',
        dimensionsMap: { TableName: dynamoTableName },
        statistic: 'Sum',
        period: cdk.Duration.minutes(1),
      });

      const throttleAlarm = new cloudwatch.Alarm(this, 'DynamoThrottleAlarm', {
        alarmName: `${serviceName}-dynamo-throttles`,
        metric: throttleMetric,
        threshold: 5,
        evaluationPeriods: 2,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      throttleAlarm.addAlarmAction(snsAction);

      widgets.push(
        new cloudwatch.GraphWidget({
          title: 'DynamoDB Throttled Requests',
          left: [throttleMetric],
          width: 12,
        })
      );
    }

    // Consolidated dashboard
    this.dashboard = new cloudwatch.Dashboard(this, 'Dashboard', {
      dashboardName: `${serviceName}-overview`,
      widgets: [widgets],
    });
  }
}
