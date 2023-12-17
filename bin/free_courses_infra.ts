#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { FreeCoursesInfraStack } from '../lib/free_courses_infra-stack';

const app = new cdk.App();
new FreeCoursesInfraStack(app, 'FreeCoursesInfraStack', {
});
