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

export { AwsPoolConfig } from "./common/lib/aws_pool_config";
export { HostInfo } from "./common/lib/host_info";
export { HostRole } from "./common/lib/host_role";
export { InternalPooledConnectionProvider } from "./common/lib/internal_pooled_connection_provider";
export {
  AwsWrapperError,
  FailoverFailedError,
  FailoverSuccessError,
  TransactionResolutionUnknownError,
  UnsupportedMethodError
} from "./common/lib/utils/errors";
export { TransactionIsolationLevel } from "./common/lib/utils/transaction_isolation_level";
export { HostAvailability } from "./common/lib/host_availability/host_availability";
export { logger } from "./common/logutils";

export type { ConnectionProvider } from "./common/lib/connection_provider";
export type { InternalPoolMapping } from "./common/lib/utils/internal_pool_mapping";
export type { HostAvailabilityStrategy } from "./common/lib/host_availability/host_availability_strategy";
