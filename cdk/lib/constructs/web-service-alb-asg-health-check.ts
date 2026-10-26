import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { Construct } from 'constructs';

export interface WebServiceProps {
  vpc: ec2.Vpc;
  appSecurityGroup: ec2.SecurityGroup;
  albSecurityGroup: ec2.SecurityGroup;
  instanceRole: iam.Role;
  instanceType?: ec2.InstanceType;
  minCapacity?: number;
  maxCapacity?: number;
  healthCheckPath?: string;
}

/**
 * L5 Construct: Application Load Balancer + Auto Scaling Group with
 * target tracking scaling, health checks, and connection draining.
 */
export class WebService extends Construct {
  public readonly alb: elbv2.ApplicationLoadBalancer;
  public readonly asg: autoscaling.AutoScalingGroup;
  public readonly listener: elbv2.ApplicationListener;
  public readonly targetGroup: elbv2.ApplicationTargetGroup;
  public readonly unhealthyHostAlarm: cloudwatch.Alarm;

  constructor(scope: Construct, id: string, props: WebServiceProps) {
    super(scope, id);

    const {
      vpc,
      appSecurityGroup,
      albSecurityGroup,
      instanceRole,
      instanceType = ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.SMALL),
      minCapacity = 1,
      maxCapacity = 4,
      healthCheckPath = '/health',
    } = props;

    // ALB in public subnets
    this.alb = new elbv2.ApplicationLoadBalancer(this, 'ALB', {
      vpc,
      internetFacing: true,
      securityGroup: albSecurityGroup,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      deletionProtection: false,
      dropInvalidHeaderFields: true,
    });

    this.listener = this.alb.addListener('HttpListener', {
      port: 80,
      open: true,
    });

    // The instances serve the target group's health check themselves: a tiny HTTP server on 8080 answers /health.
    // Without something listening, the ELB health check would fail and the ASG would replace every instance forever.
    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      'mkdir -p /opt/app',
      'echo ok > /opt/app/health',
      'cat > /etc/systemd/system/app.service <<EOF',
      '[Unit]',
      'Description=Demo app (static /health)',
      'After=network.target',
      '[Service]',
      'WorkingDirectory=/opt/app',
      'ExecStart=/usr/bin/python3 -m http.server 8080',
      'Restart=always',
      '[Install]',
      'WantedBy=multi-user.target',
      'EOF',
      'systemctl daemon-reload',
      'systemctl enable --now app.service',
    );

    // Launch template
    const launchTemplate = new ec2.LaunchTemplate(this, 'LaunchTemplate', {
      instanceType,
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      securityGroup: appSecurityGroup,
      role: instanceRole,
      userData,
      requireImdsv2: true,
      detailedMonitoring: false,
    });

    // ASG in private subnets
    this.asg = new autoscaling.AutoScalingGroup(this, 'ASG', {
      vpc,
      launchTemplate,
      minCapacity,
      maxCapacity,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      healthChecks: autoscaling.HealthChecks.withAdditionalChecks({
        additionalTypes: [autoscaling.AdditionalHealthCheckType.ELB],
        gracePeriod: cdk.Duration.seconds(60),
      }),
      updatePolicy: autoscaling.UpdatePolicy.rollingUpdate({
        maxBatchSize: 1,
        minInstancesInService: 1,
        pauseTime: cdk.Duration.seconds(30),
      }),
    });

    // Target tracking: keep CPU at 60%
    this.asg.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 60,
      cooldown: cdk.Duration.seconds(300),
    });

    this.targetGroup = new elbv2.ApplicationTargetGroup(this, 'TargetGroup', {
      vpc,
      port: 8080,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.INSTANCE,
      healthCheck: {
        path: healthCheckPath,
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
      deregistrationDelay: cdk.Duration.seconds(30),
    });

    this.asg.attachToApplicationTargetGroup(this.targetGroup);

    this.listener.addTargetGroups('AppTargets', {
      targetGroups: [this.targetGroup],
    });

    // Alarm: unhealthy host count
    this.unhealthyHostAlarm = new cloudwatch.Alarm(this, 'UnhealthyHostAlarm', {
      metric: this.targetGroup.metrics.unhealthyHostCount(),
      threshold: 1,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription: 'One or more targets are unhealthy',
    });
  }
}
