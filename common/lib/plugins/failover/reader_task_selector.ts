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

/**
 * This class tracks which connection attempt task in a failover session has already been completed, so other tasks can clean up their resources accordingly.
 * Throughout the lifespan of an AwsClient the ClusterAwareReaderFailoverHandler is only initialized once when creating the AwsClient.
 * When failover occurs and the underlying target client changes, the ClusterAwareReaderFailoverHandler does not get reinitialized.
 * This means the same failover handler may be used for several different failover tasks.
 * During each failover task, the handler sends batches of connection attempt tasks.
 * Since connection attempts cannot be aborted, there may be scenarios where connection attempts succeeded after failover has completed and another connection has already been returned to the client application.
 * When this occurs, the connection attempt task needs to know if another connection attempt task from this failover session has already completed. This class helps achieve that.
 */
export class ReaderTaskSelectorHandler {
  protected tasks: Map<string, number> = new Map();

  public trackFailoverTask(failoverTaskId: string) {
    this.tasks.set(failoverTaskId, -1);
  }

  public getSelectedConnectionAttemptTask(failoverTaskId: string): number | undefined {
    return this.tasks.get(failoverTaskId);
  }

  public setSelectedConnectionAttemptTask(failoverTaskId: string, taskId: number){
    this.tasks.set(failoverTaskId, taskId);
  }
}
