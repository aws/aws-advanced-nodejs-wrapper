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
import { AwsWrapperError } from "./errors";
import { logger } from "../../logutils";
import { WrapperProperties } from "../wrapper_property";

export class ClientUtils {
  static async queryWithTimeout(newPromise: Promise<any>, props: Map<string, any>, timeValue?: number): Promise<any> {
    const timer: any = {};
    const timeoutTask = getTimeoutTask(
      timer,
      Messages.get("ClientUtils.queryTaskTimeout"),
      timeValue ?? WrapperProperties.INTERNAL_QUERY_TIMEOUT.get(props)
    );
    return await Promise.race([timeoutTask, newPromise])
      .then((result) => {
        if (result) {
          return result;
        }
        throw new AwsWrapperError(Messages.get("ClientUtils.queryTaskTimeout"));
      })
      .catch((error: any) => {
        logger.debug(error);
        throw new AwsWrapperError(error);
      })
      .finally(() => {
        clearTimeout(timer.timeoutId);
      });
  }
}
