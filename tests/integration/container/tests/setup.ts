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

import { TestEnvironment } from "./utils/test_environment";
import { ProxyHelper } from "./utils/proxy_helper";

/* eslint-disable @typescript-eslint/no-unused-vars */
export default async (globalConfig: any, projectConfig: any) => {
  // console.log(globalConfig);

  const info = (await TestEnvironment.getCurrent()).info;
  const request = info.request;

  const reportSetting: string = `${request.deployment}-${request.engine}_instance-${request.instanceCount}`;
  process.env["JEST_HTML_REPORTER_OUTPUT_PATH"] = `./tests/integration/container/reports/${reportSetting}.html`;
  process.env["JEST_HTML_REPORTER_INCLUDE_FAILURE_MSG"] = "true";
  process.env["JEST_HTML_REPORTER_INCLUDE_CONSOLE_LOG"] = "true";

  await ProxyHelper.enableAllConnectivity();
  await TestEnvironment.verifyClusterStatus();
};
