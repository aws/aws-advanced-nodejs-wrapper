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

import { getTimeoutTask } from "./utils";
import { Messages } from "./messages";
import { AwsWrapperError, InternalQueryTimeoutError } from "./errors";
import { WrapperProperties } from "../wrapper_property";
import { logger } from "../../logutils";

export class ClientUtils {
  static hasWarnedDeprecation: boolean = false;
  static async queryWithTimeout(newPromise: Promise<any>, props: Map<string, any>, timeValue?: number): Promise<any> {
    const timer: any = {};
    let timeout = timeValue;
    if (props.has(WrapperProperties.INTERNAL_QUERY_TIMEOUT.name)) {
      timeout = WrapperProperties.INTERNAL_QUERY_TIMEOUT.get(props);
      if (!ClientUtils.hasWarnedDeprecation) {
        logger.warn(
          "The connection configuration property 'mysqlQueryTimeout' is deprecated since version 1.1.0. Please use 'wrapperQueryTimeout' instead."
        );
        ClientUtils.hasWarnedDeprecation = true;
      }
    }
    if (!timeout) {
      timeout = WrapperProperties.WRAPPER_QUERY_TIMEOUT.get(props);
    }
    const timeoutTask = getTimeoutTask(timer, Messages.get("ClientUtils.queryTaskTimeout"), timeout);
    return await Promise.race([timeoutTask, newPromise])
      .catch((error: any) => {
        if (error instanceof InternalQueryTimeoutError) {
          throw error;
        }
        throw new AwsWrapperError(error.message, error);
      })
      .finally(() => {
        clearTimeout(timer.timeoutId);
      });
  }
}
