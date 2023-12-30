import * as cdk from 'aws-cdk-lib';
import {CfnParameter, Duration} from 'aws-cdk-lib';
import {Construct} from 'constructs';
import {AttributeType, Table} from 'aws-cdk-lib/aws-dynamodb';
import {Role, ServicePrincipal} from 'aws-cdk-lib/aws-iam';
import {
  AsgCapacityProvider,
  Cluster,
  ContainerImage,
  EcsOptimizedImage, FargateService, FargateTaskDefinition,
  LogDriver,
  Protocol
} from "aws-cdk-lib/aws-ecs";
import {
  InstanceClass,
  InstanceSize,
  InstanceType,
  InterfaceVpcEndpointAwsService,
  IpAddresses,
  SubnetType,
  Vpc
} from "aws-cdk-lib/aws-ec2";
import {AutoScalingGroup} from "aws-cdk-lib/aws-autoscaling";
import {Repository, TagStatus} from "aws-cdk-lib/aws-ecr";
import {
  ApplicationLoadBalancer,
  ApplicationProtocol,
  ApplicationTargetGroup
} from "aws-cdk-lib/aws-elasticloadbalancingv2";

export class FreeCoursesInfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const serviceVersion = new CfnParameter(this, 'serviceVersion', {
      type: 'String',
      description: 'The version of the service to deploy',
    });

    const vpc = this.createVpc();

    const ecrRepository = new Repository(this, 'courses-service', {
      repositoryName: 'courses-service',
      lifecycleRules: [
        {
          tagStatus: TagStatus.TAGGED,
          tagPrefixList: ['non-production'],
          maxImageAge: Duration.days(7)
        }
      ]
    });

    const autoScalingGroup = new AutoScalingGroup(this, 'free-courses-cluster-asg', {
      vpc: vpc,
      vpcSubnets: vpc.selectSubnets({subnetType: SubnetType.PRIVATE_ISOLATED}),
      instanceType: InstanceType.of(InstanceClass.T2, InstanceSize.NANO),
      machineImage: EcsOptimizedImage.amazonLinux2(),
      desiredCapacity: 1,
      maxCapacity: 2,
      newInstancesProtectedFromScaleIn: false,
      requireImdsv2: true,
    });

    const capacityProvider = new AsgCapacityProvider(this, 'free-courses-capacity-provider', {
      autoScalingGroup: autoScalingGroup,
    });

    const targetGroup = new ApplicationTargetGroup(this, 'free-courses-target-group', {
      vpc: vpc,
      port: 8080,
      protocol: ApplicationProtocol.HTTP,
      targets: [autoScalingGroup]
    });

    const ecsCluster = new Cluster(this, 'free-courses-cluster', {
      clusterName: 'free-courses-cluster',
      vpc: vpc,
      containerInsights: true,
    });

    const freeCoursesServiceExecutionRole = new Role(this, 'service-execution-role', {
      roleName: 'service-execution-role',
      assumedBy: new ServicePrincipal('ecs-tasks.amazonaws.com')
    });

    const ddbRole = new Role(this, 'courses-table-role', {
      roleName: 'courses-table-access-role',
      assumedBy: freeCoursesServiceExecutionRole
    });
    ddbRole.grantAssumeRole(freeCoursesServiceExecutionRole);

    const taskDefinition = this.createTaskDefinition(freeCoursesServiceExecutionRole, ddbRole, ecrRepository, serviceVersion.valueAsString);


    new FargateService(this, 'free-courses-service', {
      serviceName: 'free-courses-service',
      cluster: ecsCluster,
      taskDefinition: taskDefinition,
      capacityProviderStrategies: [
        {
          capacityProvider: capacityProvider.capacityProviderName,
          weight: 1,
        }
      ]
    });

    this.createDdbTable(ddbRole);
    this.createAlb(vpc, targetGroup);
  }

  /**
   * Creates the vpc for the courses service.
   * The vpc will have 2 AZs with public and isolated subnets.
   * The isolated subnet has interface endpoints for ecr_docker, cloudwatch and sts.
   */
  private createVpc(): Vpc {
    const vpc = new Vpc(this, 'free-courses-vpc', {
      ipAddresses: IpAddresses.cidr('10.0.0.0/26'),
      maxAzs: 2,
      createInternetGateway: true,
      subnetConfiguration: [
        {
          name: 'free-courses-vpc-private-subnet',
          subnetType: SubnetType.PRIVATE_ISOLATED,
          cidrMask: 28,
        },
        {
          name: 'free-courses-vpc-public-subnet',
          subnetType: SubnetType.PUBLIC,
          cidrMask: 28,
        }
      ],
    });

    vpc.addInterfaceEndpoint('ecr-docker-vpc-endpoint', {
      service: InterfaceVpcEndpointAwsService.ECR_DOCKER,
      subnets: vpc.selectSubnets({subnetType: SubnetType.PRIVATE_ISOLATED}),
      open: true,
    });

    vpc.addInterfaceEndpoint('cloudwatch-vpc-endpoint', {
      service: InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
      subnets: vpc.selectSubnets({subnetType: SubnetType.PRIVATE_ISOLATED}),
      open: true,
    });

    vpc.addInterfaceEndpoint('sts-vpc-endpoint', {
      service: InterfaceVpcEndpointAwsService.STS,
      subnets: vpc.selectSubnets({subnetType: SubnetType.PRIVATE_ISOLATED}),
      open: true,
    });

    return vpc;
  }

  /**
   * Creates the task definition for the service.
   *
   * @param executionRole  the service execution role.
   * @param ddbReadRole    the role for reading from the dynamodb table.
   * @param ecrRepository  the ecr repository for the service.
   * @param serviceVersion the version of the service to deploy.
   * @returns {FargateTaskDefinition}
   */
  private createTaskDefinition(executionRole: Role, ddbReadRole: Role, ecrRepository: Repository, serviceVersion: string): FargateTaskDefinition {
    const taskDefinition = new FargateTaskDefinition(this, 'free-courses-task-definition', {
      taskRole: executionRole,
      cpu: 1024
    });

    taskDefinition.addContainer('free-courses-container', {
      image: ContainerImage.fromEcrRepository(ecrRepository, serviceVersion),
      healthCheck: {
        command: ['CMD-SHELL', 'curl -f http://localhost:8080/actuator/health || exit 1'],
        interval: Duration.seconds(30),
        timeout: Duration.seconds(3),
        retries: 5,
        startPeriod: Duration.seconds(180)
      },
      environment: {
        DYNAMO_DB_ACCESS_ROLE: ddbReadRole.roleArn,
        AWS_REGION: this.region,
      },
      cpu: 1024,
      memoryReservationMiB: 512,
      logging: LogDriver.awsLogs({streamPrefix: 'my-log-group'}),
      portMappings: [
        {containerPort: 8080, hostPort: 8080, protocol: Protocol.TCP}
      ],
    });

    return taskDefinition;
  }

  /**
   * Creates the application load balancer for the service.
   *
   * @param vpc         the vpc for the service.
   * @param targetGroup the target group for the service.
   * @returns {ApplicationLoadBalancer}
   */
  private createAlb(vpc: Vpc, targetGroup: ApplicationTargetGroup): ApplicationLoadBalancer {
    const applicationLoadBalancer = new ApplicationLoadBalancer(this, 'free-courses-alb', {
      vpc: vpc,
      vpcSubnets: vpc.selectSubnets({subnetType: SubnetType.PUBLIC}),
      internetFacing: true,
    });

    // create a target for the application load balancer to the ecs service
    applicationLoadBalancer.addListener('free-courses-listener', {
      port: 80,
      protocol: ApplicationProtocol.HTTP,
      defaultTargetGroups: [
        targetGroup
      ]
    });

    return applicationLoadBalancer;
  }

  /**
   * Creates the dynamodb table for the courses.
   * @param ddbReadRole the role for reading from and writing to the dynamodb table.
   * @returns {Table}
   */
  private createDdbTable(ddbReadRole: Role): Table {
    const ddbTable = new Table(this, 'courses-table', {
      tableName: 'courses-table',
      partitionKey: {
        name: 'id',
        type: AttributeType.STRING
      },
      sortKey: {
        name: 'sortKey',
        type: AttributeType.STRING
      },
    });

    ddbTable.addGlobalSecondaryIndex({
      indexName: 'category-subcategory-index',
      partitionKey: {
        name: 'sortKey',
        type: AttributeType.STRING
      },
      sortKey: {
        name: 'csGsiSk',
        type: AttributeType.STRING
      }
    });

    ddbTable.grantReadWriteData(ddbReadRole);

    return ddbTable;
  }
}
