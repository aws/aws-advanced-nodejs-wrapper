/*
  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 
  Licensed under the Apache License, Version 2.0 (the "License").
  You may not use this file except in compliance with the License.
  You may obtain a copy of the License at
 
  http://www.apache.org/licenses/LICENSE-2.0
 
  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
*/

export enum TestEnvironmentFeatures {
  IAM = "IAM",
  SECRETS_MANAGER = "SECRETS_MANAGER",
  FAILOVER_SUPPORTED = "FAILOVER_SUPPORTED",
  ABORT_CONNECTION_SUPPORTED = "ABORT_CONNECTION_SUPPORTED",
  NETWORK_OUTAGES_ENABLED = "NETWORK_OUTAGES_ENABLED",
  AWS_CREDENTIALS_ENABLED = "AWS_CREDENTIALS_ENABLED",
  PERFORMANCE = "PERFORMANCE",
  RUN_AUTOSCALING_TESTS_ONLY = "RUN_AUTOSCALING_TESTS_ONLY",
  SKIP_MYSQL_DRIVER_TESTS = "SKIP_MYSQL_DRIVER_TESTS",
  SKIP_PG_DRIVER_TESTS = "SKIP_PG_DRIVER_TESTS",
  RDS_MULTI_AZ_CLUSTER_SUPPORTED = "RDS_MULTI_AZ_CLUSTER_SUPPORTED",
  BLUE_GREEN_DEPLOYMENT = "BLUE_GREEN_DEPLOYMENT"
}
