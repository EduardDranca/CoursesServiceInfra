import * as cdk from 'aws-cdk-lib';
import {Construct} from 'constructs';
import {AttributeType, Table} from 'aws-cdk-lib/aws-dynamodb';
import {AccountRootPrincipal, Role, ServicePrincipal} from 'aws-cdk-lib/aws-iam';
import {Cluster} from "aws-cdk-lib/aws-ecs";

export class FreeCoursesInfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const ecsCluster = new Cluster(this, 'free-courses-cluster', {

    })

    const freeCoursesServiceExecutionRole = new Role(this, 'service-execution-role', {
      roleName: 'service-execution-role',
      assumedBy: new ServicePrincipal('ecs.amazonaws.com')
    });

    const ddbReadRole = new Role(this, 'courses-table-role', {
      roleName: 'courses-table-access-role',
      assumedBy: freeCoursesServiceExecutionRole
    });

    ddbReadRole.grantAssumeRole(new AccountRootPrincipal);
    ddbTable.grantReadWriteData(ddbReadRole);
  }
}
