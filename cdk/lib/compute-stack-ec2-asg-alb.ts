import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import { WebService } from './constructs/web-service-alb-asg-health-check';
import { Monitoring } from './constructs/monitoring-cloudwatch-alarms-dashboard';

interface ComputeStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  appSecurityGroup: ec2.SecurityGroup;
  albSecurityGroup: ec2.SecurityGroup;
}

export class ComputeStack extends cdk.Stack {
  public readonly alb: elbv2.ApplicationLoadBalancer;
  public readonly asg: autoscaling.AutoScalingGroup;

  constructor(scope: Construct, id: string, props: ComputeStackProps) {
    super(scope, id, props);

    const { vpc, appSecurityGroup, albSecurityGroup } = props;

    // Instance role with SSM access
    const instanceRole = new iam.Role(this, 'InstanceRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy'),
      ],
    });

    // L5 reusable WebService construct
    const webService = new WebService(this, 'WebService', {
      vpc,
      appSecurityGroup,
      albSecurityGroup,
      instanceRole,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.SMALL),
      minCapacity: 1,
      maxCapacity: 4,
      healthCheckPath: '/health',
    });

    // Alarms on 5xx, latency and CPU, one SNS topic, one dashboard; the unhealthy-host alarm notifies the same topic.
    const monitoring = new Monitoring(this, 'Monitoring', {
      serviceName: `${this.stackName}-web`,
      albFullName: webService.alb.loadBalancerFullName,
      asgName: webService.asg.autoScalingGroupName,
    });
    webService.unhealthyHostAlarm.addAlarmAction(new cwActions.SnsAction(monitoring.alarmTopic));

    this.alb = webService.alb;
    this.asg = webService.asg;

    new cdk.CfnOutput(this, 'AlbDnsName', { value: this.alb.loadBalancerDnsName });
    new cdk.CfnOutput(this, 'AsgName', { value: this.asg.autoScalingGroupName });
  }
}
