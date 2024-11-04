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

import { CustomConsole, LogMessage, LogType } from "@jest/console";

function simpleFormatter(type: LogType, message: LogMessage): string {
  return message
    .split(/\n/)
    .map((line) => "      " + line)
    .join("\n");
}

global.console = new CustomConsole(process.stdout, process.stderr, simpleFormatter);

const infoJson = process.env.TEST_ENV_INFO_JSON;
if (infoJson === undefined) {
  throw new Error("env var required");
}

const testInfo = JSON.parse(infoJson);
const request = testInfo.request;
export const features = request.features;
export const instanceCount = request.numOfInstances;

const reportSetting: string = `${request.deployment}-${request.engine}_instance-${request.instanceCount}`;
process.env["JEST_HTML_REPORTER_OUTPUT_PATH"] = `./tests/integration/container/reports/${reportSetting}.html`;
process.env["JEST_HTML_REPORTER_INCLUDE_FAILURE_MSG"] = "true";
process.env["JEST_HTML_REPORTER_INCLUDE_CONSOLE_LOG"] = "true";
